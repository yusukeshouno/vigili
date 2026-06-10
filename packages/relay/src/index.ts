/**
 * Sentinel Relay のエントリポイント。
 *
 * 役割は README 参照。Phase 14-A:
 *   - SQLite による accounts / sessions / pairings / devices 永続化
 *   - signup / signin / pairings / devices REST API
 *   - WSS auth + pairing 単位の fan-out
 *
 * 後続フェーズ (14-D 以降) で APNs Push と IAP 検証を追加する。
 */

import { randomUUID } from "node:crypto";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
// 型のみ import (runtime 依存を増やさない)。fastify-websocket の socket は ws の WebSocket。
import type { WebSocket as WsWebSocket } from "ws";
import { z } from "zod";
import { type ApnsSender, createApnsSenderFromEnv } from "./apns.js";
import { type AppleVerifier, createAppleVerifierFromEnv } from "./apple.js";
import {
  constantTimeEqualString,
  generatePairingId,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./auth.js";
import { type PairingRow, type RelayStore, openRelayStore } from "./db.js";
import { type HubSocket, type PairingHub, createPairingHub } from "./hub.js";
import { extractBearer, issueSession, verifySessionToken } from "./session.js";

export interface RelayOptions {
  port: number;
  host?: string;
  /** SQLite DB のパス。":memory:" でテスト用に揮発化。デフォルト ~/.sentinel/relay.db */
  dbPath?: string;
  /** ログ関数。デフォルト console.error */
  log?: (msg: string) => void;
  /** 既存の store を渡してテストで再利用するためのフック */
  store?: RelayStore;
  /** 既存の hub を渡してテストで観察するためのフック */
  hub?: PairingHub;
  /** 既存の APNs sender を渡してテストで観察するためのフック。未指定なら env から組む。 */
  apns?: ApnsSender;
  /** Apple identity token 検証器。未指定なら env (JWKS) から組む。テストで差し替え可。 */
  apple?: AppleVerifier;
}

export interface RunningRelay {
  url: string;
  port: number;
  close: () => Promise<void>;
  store: RelayStore;
  hub: PairingHub;
}

const SignupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});

const SigninSchema = SignupSchema;

const CreatePairingSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

const RegisterDeviceSchema = z.object({
  pairing_id: z.string().uuid(),
  apns_token: z.string().min(8).max(256),
  platform: z.enum(["ios", "ipados", "macos"]),
});

/**
 * iOS app は account session ではなく QR で受け取った user_token しか持たない。
 * そのため pairing は URL の :pid + Bearer user_token で識別し、body には端末側の
 * apns_token / platform だけを載せる (pairing_id は path から取る)。
 */
const ClientRegisterDeviceSchema = z.object({
  apns_token: z.string().min(8).max(256),
  platform: z.enum(["ios", "ipados", "macos"]),
});

const AppleAuthSchema = z.object({
  identity_token: z.string().min(1).max(8192),
  nonce: z.string().min(1).max(256),
});

/** account session 認証の device 登録 (pairing 非依存)。 */
const AccountDeviceSchema = z.object({
  apns_token: z.string().min(8).max(256),
  platform: z.enum(["ios", "ipados", "macos"]),
});

export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  const log = options.log ?? ((m) => console.error(m));
  const dbPath = options.dbPath ?? `${process.env.HOME ?? ""}/.sentinel/relay.db`;
  const store = options.store ?? openRelayStore(dbPath);
  const hub = options.hub ?? createPairingHub(log);
  const ownsStore = !options.store;
  const apns = options.apns ?? createApnsSenderFromEnv(log);
  const apple = options.apple ?? createAppleVerifierFromEnv(log);

  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  // Apple Web Sign in (§10.5) の form_post は application/x-www-form-urlencoded で来る。
  // 依存を増やさず標準 URLSearchParams でパースする。
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        done(null, Object.fromEntries(params.entries()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get("/healthz", async () => ({ ok: true, version: 1 }));

  // ---------- REST: auth ----------

  app.post("/v1/signup", async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }
    const email = parsed.data.email.toLowerCase();
    if (store.findAccountByEmail(email)) {
      return reply.code(409).send({ error: "email_in_use" });
    }
    const id = randomUUID();
    const password_hash = await hashPassword(parsed.data.password);
    const now = Date.now();
    store.insertAccount({ id, email, password_hash, created_at: now });
    const session = issueSession(store, id, now);
    log(`[relay] signup account=${id} email=${email}`);
    return reply.code(201).send({
      account: { id, email },
      session: { token: session.token, expires_at: session.expires_at },
    });
  });

  app.post("/v1/signin", async (req, reply) => {
    const parsed = SigninSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const email = parsed.data.email.toLowerCase();
    const account = store.findAccountByEmail(email);
    if (!account) {
      // タイミング攻撃緩和: 存在しなくても verifyPassword 相当の遅延を出す
      await verifyPassword(parsed.data.password, "scrypt$00$00");
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await verifyPassword(parsed.data.password, account.password_hash);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });
    const session = issueSession(store, account.id);
    log(`[relay] signin account=${account.id}`);
    return reply.send({
      account: { id: account.id, email: account.email },
      session: { token: session.token, expires_at: session.expires_at },
    });
  });

  app.post("/v1/auth/apple", async (req, reply) => {
    const parsed = AppleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    let identity: { sub: string; email: string | null };
    try {
      identity = await apple.verify(parsed.data.identity_token, parsed.data.nonce);
    } catch (err) {
      // 検証失敗は理由コードのみログ (token は出さない)。fail-closed で 401。
      log(`[relay] apple auth rejected: ${(err as Error).message}`);
      return reply.code(401).send({ error: "invalid_apple_token" });
    }
    const account = findOrCreateAppleAccount(identity.sub);
    if (!account) return reply.code(500).send({ error: "account_persist_failed" });
    const session = issueSession(store, account.id);
    return reply.send({
      account: { id: account.id, email: identity.email },
      session: { token: session.token, expires_at: session.expires_at },
    });
  });

  // Apple sub で find-or-create (email では紐付けない — email 乗っ取り防止)。
  function findOrCreateAppleAccount(sub: string) {
    const existing = store.findAccountByAppleSub(sub);
    if (existing) {
      log(`[relay] apple signin account=${existing.id}`);
      return existing;
    }
    const id = randomUUID();
    // email 列は UNIQUE NOT NULL のため衝突しない合成値を入れる。実 email は応答でのみ返す。
    store.insertAppleAccount({
      id,
      email: `appleid:${sub}`,
      apple_sub: sub,
      created_at: Date.now(),
    });
    log(`[relay] apple account created account=${id}`);
    return store.findAccountById(id);
  }

  // Web Sign in with Apple (SPEC §10.5): Mac アプリが ASWebAuthenticationSession で
  // appleid.apple.com を開き、Apple が id_token をここに form_post する。
  // 検証 → アカウント解決 → session 発行 → vigili://auth-callback へ 302 で戻す。
  // 認証不要・公開エンドポイント (Apple からの POST を受けるため)。
  app.post("/v1/auth/apple/web-callback", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idToken = typeof body.id_token === "string" ? body.id_token : "";
    const state = typeof body.state === "string" ? body.state : "";
    const errback = (reason: string) => {
      // アプリ側にエラーを返して session を渡さない。state は CSRF/起動元バインド用に往復。
      const qs = new URLSearchParams({ error: reason, ...(state ? { state } : {}) });
      return reply.code(302).header("location", `vigili://auth-callback?${qs}`).send();
    };
    if (!idToken) return errback("missing_id_token");
    let identity: { sub: string; email: string | null };
    try {
      identity = await apple.verifyWeb(idToken);
    } catch (err) {
      log(`[relay] apple web auth rejected: ${(err as Error).message}`);
      return errback("invalid_apple_token");
    }
    const account = findOrCreateAppleAccount(identity.sub);
    if (!account) return errback("account_persist_failed");
    const session = issueSession(store, account.id);
    const qs = new URLSearchParams({
      session: session.token,
      account_id: account.id,
      ...(identity.email ? { email: identity.email } : {}),
      ...(state ? { state } : {}),
    });
    return reply.code(302).header("location", `vigili://auth-callback?${qs}`).send();
  });

  app.post("/v1/signout", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    store.deleteSession(auth.token_hash);
    return reply.code(204).send();
  });

  app.get("/v1/me", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const account = store.findAccountById(auth.account_id);
    if (!account) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ id: account.id, email: account.email });
  });

  // ---------- REST: pairings ----------

  app.post("/v1/pairings", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const parsed = CreatePairingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const id = generatePairingId();
    const agent_key = generateToken();
    const user_token = generateToken();
    const now = Date.now();
    store.insertPairing({
      id,
      account_id: auth.account_id,
      name: parsed.data.name ?? null,
      agent_key_hash: hashToken(agent_key),
      user_token_hash: hashToken(user_token),
      created_at: now,
    });
    log(`[relay] pairing created id=${id} account=${auth.account_id}`);
    return reply.code(201).send({
      id,
      name: parsed.data.name ?? null,
      agent_key,
      user_token,
      created_at: now,
    });
  });

  app.get("/v1/pairings/me", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const rows = store.listPairingsForAccount(auth.account_id);
    return reply.send({
      pairings: rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        agent_online: hub.isAgentOnline(r.id),
      })),
    });
  });

  app.delete("/v1/pairings/:pid", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const pid = (req.params as { pid: string }).pid;
    const ok = store.deletePairing(pid, auth.account_id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // ---------- REST: devices (APNs はまだ送らない、登録だけ) ----------

  app.post("/v1/devices", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const parsed = RegisterDeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const pairing = store.findPairingById(parsed.data.pairing_id);
    if (!pairing || pairing.account_id !== auth.account_id) {
      return reply.code(404).send({ error: "pairing_not_found" });
    }
    const now = Date.now();
    store.upsertDevice({
      id: randomUUID(),
      account_id: auth.account_id,
      pairing_id: parsed.data.pairing_id,
      apns_token: parsed.data.apns_token,
      platform: parsed.data.platform,
      last_seen_at: now,
      created_at: now,
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/v1/devices/:apnsToken", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const apnsToken = (req.params as { apnsToken: string }).apnsToken;
    const ok = store.deleteDeviceByToken(apnsToken);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // ---------- REST: client device registration (user_token 認証) ----------
  //
  // iOS app が APNs device token を登録する経路。WS client と同じ user_token で
  // 認証し、pairing は path の :pid から取る。これが無いと off-LAN で
  // バックグラウンドの端末を起こせない (= push が飛ばせない)。

  app.post("/v1/clients/:pid/devices", async (req, reply) => {
    const pid = (req.params as { pid: string }).pid;
    const provided = extractBearer(req.headers.authorization, req.url ?? "");
    if (!provided) return reply.code(401).send({ error: "unauthorized" });
    const pairing = store.findPairingById(pid);
    if (!pairing) return reply.code(404).send({ error: "pairing_not_found" });
    if (!constantTimeEqualString(hashToken(provided), pairing.user_token_hash)) {
      return reply.code(401).send({ error: "invalid_user_token" });
    }
    const parsed = ClientRegisterDeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const now = Date.now();
    store.upsertDevice({
      id: randomUUID(),
      account_id: pairing.account_id,
      pairing_id: pid,
      apns_token: parsed.data.apns_token,
      platform: parsed.data.platform,
      last_seen_at: now,
      created_at: now,
    });
    log(`[relay] device registered pairing=${pid} platform=${parsed.data.platform}`);
    return reply.code(201).send({ ok: true });
  });

  // ---------- REST: account device registration (session 認証) ----------
  //
  // Sign in with Apple したクライアントは account session を持つので、pairing_id 無しで
  // アカウントに直接 device を登録する。push は同一アカウントの全 agent の pending で飛ぶ。

  app.post("/v1/account/devices", async (req, reply) => {
    const auth = requireAccount(req, reply);
    if (!auth) return;
    const parsed = AccountDeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const now = Date.now();
    store.upsertDevice({
      id: randomUUID(),
      account_id: auth.account_id,
      pairing_id: null,
      apns_token: parsed.data.apns_token,
      platform: parsed.data.platform,
      last_seen_at: now,
      created_at: now,
    });
    log(
      `[relay] account device registered account=${auth.account_id} platform=${parsed.data.platform}`,
    );
    return reply.code(201).send({ ok: true });
  });

  // ---------- WSS: agents (Mac daemon) ----------

  app.get(
    "/v1/agents/:pid",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const pid = (req.params as { pid: string }).pid;
        const provided = extractBearer(req.headers.authorization, req.url ?? "");
        if (!provided) {
          return reply.code(401).send({ error: "missing_credentials" });
        }
        const pairing = store.findPairingById(pid);
        if (!pairing) return reply.code(404).send({ error: "pairing_not_found" });
        if (!constantTimeEqualString(hashToken(provided), pairing.agent_key_hash)) {
          return reply.code(401).send({ error: "invalid_agent_key" });
        }
      },
    },
    (socket, req) => {
      const pid = (req.params as { pid: string }).pid;
      // preValidation を通過しているので pairing は必ず存在する。account_id を hub に渡す。
      const accountId = store.findPairingById(pid)?.account_id ?? "";
      const wrap = wrapSocket(socket);
      const { detach } = hub.attachAgent(pid, wrap, accountId);
      const stopKeepalive = setupKeepalive(socket, log, `agent pid=${pid}`);
      socket.on("message", (raw: Buffer) => {
        const text = raw.toString("utf-8");
        hub.forwardAgentToClients(pid, text);
        // off-LAN でバックグラウンドの端末は WS がサスペンドされるので、
        // 新規 pending はここで APNs push して起こす。
        void maybePushApns(pid, text);
      });
      socket.on("close", () => {
        stopKeepalive();
        detach();
      });
      socket.on("error", () => {
        stopKeepalive();
        detach();
      });
    },
  );

  // ---------- WSS: clients (iOS app など) ----------

  app.get(
    "/v1/clients/:pid",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const pid = (req.params as { pid: string }).pid;
        const provided = extractBearer(req.headers.authorization, req.url ?? "");
        if (!provided) {
          return reply.code(401).send({ error: "missing_credentials" });
        }
        const pairing = store.findPairingById(pid);
        if (!pairing) return reply.code(404).send({ error: "pairing_not_found" });
        if (!constantTimeEqualString(hashToken(provided), pairing.user_token_hash)) {
          return reply.code(401).send({ error: "invalid_user_token" });
        }
      },
    },
    (socket, req) => {
      const pid = (req.params as { pid: string }).pid;
      const wrap = wrapSocket(socket);
      const { detach } = hub.attachClient(pid, wrap);
      const stopKeepalive = setupKeepalive(socket, log, `client pid=${pid}`);
      socket.on("message", (raw: Buffer) => {
        hub.forwardClientToAgent(pid, raw.toString("utf-8"));
      });
      socket.on("close", () => {
        stopKeepalive();
        detach();
      });
      socket.on("error", () => {
        stopKeepalive();
        detach();
      });
    },
  );

  // ---------- WSS: account stream (Sign in with Apple したクライアント) ----------
  //
  // session 認証で account に直接ぶら下がる。アカウント内の全 agent の pending/質問/plan を
  // 受け取り、decide/answer 等はアカウント内の全 agent へブロードキャストする。

  app.get(
    "/v1/account/stream",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const provided = extractBearer(req.headers.authorization, req.url ?? "");
        if (!provided) return reply.code(401).send({ error: "missing_credentials" });
        const auth = verifySessionToken(store, provided);
        if (!auth) return reply.code(401).send({ error: "invalid_session" });
        (req as FastifyRequest & { accountId?: string }).accountId = auth.account_id;
      },
    },
    (socket, req) => {
      const accountId = (req as FastifyRequest & { accountId?: string }).accountId ?? "";
      const wrap = wrapSocket(socket);
      const { detach } = hub.attachAccountClient(accountId, wrap);
      const stopKeepalive = setupKeepalive(socket, log, `account ${accountId}`);
      socket.on("message", (raw: Buffer) => {
        hub.forwardAccountClientToAgents(accountId, raw.toString("utf-8"));
      });
      socket.on("close", () => {
        stopKeepalive();
        detach();
      });
      socket.on("error", () => {
        stopKeepalive();
        detach();
      });
    },
  );

  // ---------- helpers ----------

  function requireAccount(
    req: FastifyRequest,
    reply: FastifyReply,
  ): { account_id: string; token_hash: string } | null {
    const provided = extractBearer(req.headers.authorization, req.url ?? "");
    if (!provided) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const auth = verifySessionToken(store, provided);
    if (!auth) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return auth;
  }

  /**
   * agent → relay の生メッセージを覗き、注意喚起イベントなら登録済み端末へ APNs push する。
   * 対象は `type:"pending"`（ツール許可。ホスト型セッションの permission もキュー経由でここに来る）、
   * `type:"question"`（AskUserQuestion）、`type:"plan"`（ExitPlanMode）。後者 2 つはキューを
   * 通らず WS で直接届くため、wake もここで個別に発火させる (SPEC §8.7)。
   * relay は本来 payload を opaque に転送するだけだが、push のためにここだけ中身を読む
   * (内容は title/body の組み立てにしか使わず、転送自体は forwardAgentToClients が別に行う)。
   */
  async function maybePushApns(pid: string, text: string): Promise<void> {
    if (!apns.enabled) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const type = (parsed as { type?: unknown }).type;

    const truncate = (s: string, max: number): string =>
      s.length > max ? `${s.slice(0, max - 1)}…` : s;

    let notice: { title: string; body: string } | null = null;

    if (type === "pending") {
      const request = (parsed as { request?: unknown }).request;
      if (typeof request === "object" && request !== null) {
        const r = request as { tool_name?: unknown; session_tag?: unknown };
        const toolName = typeof r.tool_name === "string" && r.tool_name ? r.tool_name : "操作";
        const tag = typeof r.session_tag === "string" && r.session_tag ? r.session_tag : null;
        notice = {
          title: tag ? `承認待ち · ${tag}` : "承認待ち",
          body: `${toolName} の実行許可を求めています`,
        };
      }
    } else if (type === "question") {
      // AskUserQuestion: キューを通らず WS で直接届く選択肢質問。
      const questions = (parsed as { questions?: unknown }).questions;
      const arr = Array.isArray(questions) ? questions : [];
      const first = arr[0];
      const qText =
        first !== null &&
        typeof first === "object" &&
        typeof (first as { question?: unknown }).question === "string"
          ? (first as { question: string }).question
          : "選択肢の回答を求めています";
      notice = {
        title: arr.length > 1 ? `質問 ${arr.length} 件が届いています` : "質問が届いています",
        body: truncate(qText, 120),
      };
    } else if (type === "plan") {
      // ExitPlanMode: plan 承認待ち。
      const plan = (parsed as { plan?: unknown }).plan;
      const planText = typeof plan === "string" ? plan : "";
      const firstLine =
        planText
          .split("\n")
          .find((l) => l.trim().length > 0)
          ?.trim() ?? "Plan の承認を求めています";
      notice = {
        title: "Plan の承認待ち",
        body: truncate(firstLine, 120),
      };
    }

    if (notice === null) return;
    const n = notice;

    // pid → account を解決し、アカウント内の全 device へ push (apns_token で de-dup)。
    // legacy per-pairing device も account-level device もまとめて起こす。
    const pairing = store.findPairingById(pid);
    const rows = pairing
      ? store.listDevicesForAccount(pairing.account_id)
      : store.listDevicesForPairing(pid);
    const seen = new Set<string>();
    const devices = rows.filter((d) => {
      if (seen.has(d.apns_token)) return false;
      seen.add(d.apns_token);
      return true;
    });
    if (devices.length === 0) return;
    await Promise.all(
      devices.map(async (d) => {
        try {
          const result = await apns.send(d.apns_token, {
            title: n.title,
            body: n.body,
            threadId: pid,
          });
          if (result.unregistered) {
            store.deleteDeviceByToken(d.apns_token);
            log(`[relay] APNs token 失効のため削除 (pairing=${pid})`);
          } else if (result.status !== 200) {
            log(`[relay] APNs send status=${result.status} reason=${result.reason ?? "-"}`);
          }
        } catch (err) {
          log(`[relay] APNs send 例外: ${(err as Error).message}`);
        }
      }),
    );
  }

  const host = options.host ?? "0.0.0.0";
  await app.listen({ port: options.port, host });
  const listenAddr = app.server.address();
  const actualPort = typeof listenAddr === "object" && listenAddr ? listenAddr.port : options.port;
  log(`[relay] listening on http://${host}:${actualPort}`);

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    store,
    hub,
    close: async () => {
      await app.close();
      apns.close();
      if (ownsStore) store.close();
    },
  };
}

/** keepalive: server からこの間隔で ping し、1 周期 pong が無ければ dead とみなす。 */
const RELAY_PING_INTERVAL_MS = 30_000;

/**
 * 接続ごとに server-side ping/pong watchdog を仕掛ける。
 *
 * 半開き (half-open) 接続 — laptop sleep / NAT mapping 失効 / proxy idle kill 等で
 * TCP の片側が消えても 'close' が飛んでこないケース — を検知する。pong が前回 ping
 * までに返らなければ terminate し、ハンドラの 'close' 経由で hub から detach させる。
 */
function setupKeepalive(socket: WsWebSocket, log: (m: string) => void, tag: string): () => void {
  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (socket.readyState !== 1 /* OPEN */) return;
    if (!alive) {
      log(`[hub] ${tag} unresponsive (no pong) — terminating`);
      try {
        socket.terminate();
      } catch {
        /* ignore */
      }
      return;
    }
    alive = false;
    try {
      socket.ping();
    } catch {
      /* ignore */
    }
  }, RELAY_PING_INTERVAL_MS);
  return () => clearInterval(timer);
}

function wrapSocket(socket: { send: (data: string) => void; close: () => void }): HubSocket {
  return {
    send(data) {
      try {
        socket.send(data);
      } catch {
        /* ignore */
      }
    },
    close() {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    },
  };
}

// 既存呼び出し元 (テスト等) との互換のため named export を残す
export { openRelayStore } from "./db.js";
export type { PairingRow };
