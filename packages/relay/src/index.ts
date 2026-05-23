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
import { z } from "zod";
import {
  constantTimeEqualString,
  generatePairingId,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./auth.js";
import { openRelayStore, type PairingRow, type RelayStore } from "./db.js";
import { createPairingHub, type HubSocket, type PairingHub } from "./hub.js";
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

export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  const log = options.log ?? ((m) => console.error(m));
  const dbPath = options.dbPath ?? `${process.env.HOME ?? ""}/.sentinel/relay.db`;
  const store = options.store ?? openRelayStore(dbPath);
  const hub = options.hub ?? createPairingHub(log);
  const ownsStore = !options.store;

  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

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
      const wrap = wrapSocket(socket);
      const { detach } = hub.attachAgent(pid, wrap);
      socket.on("message", (raw: Buffer) => {
        hub.forwardAgentToClients(pid, raw.toString("utf-8"));
      });
      socket.on("close", () => detach());
      socket.on("error", () => detach());
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
      socket.on("message", (raw: Buffer) => {
        hub.forwardClientToAgent(pid, raw.toString("utf-8"));
      });
      socket.on("close", () => detach());
      socket.on("error", () => detach());
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

  const host = options.host ?? "0.0.0.0";
  await app.listen({ port: options.port, host });
  const listenAddr = app.server.address();
  const actualPort =
    typeof listenAddr === "object" && listenAddr ? listenAddr.port : options.port;
  log(`[relay] listening on http://${host}:${actualPort}`);

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    store,
    hub,
    close: async () => {
      await app.close();
      if (ownsStore) store.close();
    },
  };
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
