import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ApprovalRequest,
  type AskResolution,
  type Decision,
  type PolicyConfig,
  type PromoteRule,
  type ToolRequest,
  ToolRequestSchema,
} from "@vigili/shared";
import { type SentinelConfig, loadConfigFile } from "./config.js";
import { type MessageStore, createMessageStore } from "./db/messages.js";
import { type RequestStore, openStore } from "./db/store.js";
import { computeStats, pruneOldRequests } from "./db/stats.js";
import { createNtfyNotifier } from "./notify/ntfy.js";
import { NULL_NOTIFIER, type Notifier, multiNotifier } from "./notify/types.js";
import {
  type SubscriptionStore,
  type VapidKeys,
  createWebPushNotifier,
  loadOrCreateVapidKeys,
  openSubscriptionStore,
} from "./notify/web-push.js";
import { paths } from "./paths.js";
import { DEFAULT_POLICY_YAML } from "./policy/default.js";
import { type DecisionResult, decide } from "./policy/engine.js";
import { loadPolicyFile } from "./policy/loader.js";
import { appendGeneratedRule, promoteToRule } from "./policy/promote.js";
import { type PendingQueue, type Resolution, createPendingQueue } from "./queue.js";
import { AdminRequestSchema, type AdminResponse } from "./server/admin.js";
import { type RelayClient, createRelayClient } from "./server/relay-client.js";
import { type ConnContext, type SocketServer, startSocketServer } from "./server/socket.js";
import { type RunningWsServer, startWsServer } from "./server/ws.js";
import { loadOrCreateToken } from "./token.js";

export interface DaemonOptions {
  /** ~/.sentinel または $SENTINEL_HOME 相当。 */
  home?: string;
  /** 明示的に policy を渡したい場合 (テスト等)。 */
  policy?: PolicyConfig;
  /** ログ出力先。デフォルトは console.error。 */
  log?: (msg: string) => void;
  /** config.yaml を読み込まずに直接渡す (テスト用)。 */
  config?: SentinelConfig;
  /** session_tags マップ。指定時は config.yaml の同名項目より優先。 */
  sessionTags?: Record<string, string>;
  /** notifier を差し替えたい場合 (テスト用)。 */
  notifier?: Notifier;
  /** WS サーバを起動するか。テストでは false にできる。 */
  enableWs?: boolean;
  /** WS サーバの port。デフォルト config.daemon.ws_port (7878)。 */
  wsPort?: number;
  /** WS サーバの host。デフォルト config.daemon.ws_host (127.0.0.1)。 */
  wsHost?: string;
}

export interface RunningDaemon {
  close(): Promise<void>;
  store: RequestStore;
  socket: SocketServer;
  ws: RunningWsServer | null;
  queue: PendingQueue;
  /** WS / PWA クライアントが使う bearer token。 */
  token: string;
}

/**
 * daemon の中核。
 *
 * Phase 4 では:
 *  - ask は queue に enroll し、gate 接続を保持したまま resolution を待つ
 *  - WS サーバを起動し、PWA からの decide を受け付ける
 *  - sentinel-cli は Unix socket 上の admin プロトコルで approve / deny する
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const p = paths(options.home);
  const log = options.log ?? ((msg) => console.error(msg));

  if (!options.policy) {
    await ensureDefaultPolicy(p.policy, log);
  }
  const initialPolicy = options.policy ?? (await loadPolicyFile(p.policy));
  const config = options.config ?? (await loadConfigFile(p.config));
  const store = openStore(p.db);
  // messages テーブルは queue.db に同居する (small, single DB で OK)
  const messageStore = createMessageStore(store.raw().db);
  const queue = createPendingQueue();
  const token = loadOrCreateToken(p.token);

  // Web Push: 有効なら VAPID 鍵 + subscription store を用意する。
  // notifier はその後で組み立てる (ntfy と並列に走らせる場合あり)。
  let pushVapid: VapidKeys | null = null;
  let pushStore: SubscriptionStore | null = null;
  if (config.push.enabled) {
    pushVapid = loadOrCreateVapidKeys(p.vapid, config.push.subject);
    pushStore = openSubscriptionStore(p.pushSubs);
    log(
      `[vigili-daemon] web-push ready (subs=${pushStore.size()}, vapid=${p.vapid})`,
    );
  }

  const notifier = resolveNotifier(options, config, log, pushVapid, pushStore);

  await writeFile(p.pid, String(process.pid), { mode: 0o600 });

  const sessionTags = options.sessionTags ?? config.session_tags;

  // policy はホットリロード可能にするため mutable な参照で持つ。
  const ctx: DaemonContext = {
    policy: initialPolicy,
    store,
    messageStore,
    queue,
    sessionTags,
    notifier,
    log,
    policyPath: p.policy,
    generatedPolicyPath: p.policyGenerated,
    onMessageAdded: () => {},
    onMessageDelivered: () => {},
  };

  const socket = startSocketServer(p.socket, (line, conn) => handleLine(line, conn, ctx));
  log(`[vigili-daemon] listening on ${p.socket}`);

  // PWA/iOS から飛んでくる client メッセージ (decide / send-message) を捌くロジックは
  // LAN WS と Relay の両方から呼ぶので関数化しておく。
  const handleClientMessage = (msg: import("@vigili/shared").WsClientMessage): void => {
    if (msg.type === "decide") {
      if (msg.promote) void handlePromote(msg.promote, ctx);
      const ok = queue.resolve(msg.id, msg.decision, "human:relay", null);
      if (!ok) log(`[vigili-relay] decide: id ${msg.id} は既に決着済み / 未知`);
    } else if (msg.type === "send-message") {
      const id = randomUUID();
      const stored = ctx.messageStore.insert({
        id,
        session_id: msg.session_id,
        body: msg.body,
        created_at: Date.now(),
      });
      ctx.onMessageAdded(stored);
    }
  };

  let ws: RunningWsServer | null = null;
  if (options.enableWs !== false) {
    ws = await startWsServer({
      port: options.wsPort ?? config.daemon.ws_port,
      host: options.wsHost ?? config.daemon.ws_host,
      token,
      queue,
      log,
      onPromote: (msg) => {
        if (msg.type !== "decide" || !msg.promote) return;
        void handlePromote(msg.promote, ctx);
      },
      onSendMessage: (session_id, body) => {
        const id = randomUUID();
        return ctx.messageStore.insert({
          id,
          session_id,
          body,
          created_at: Date.now(),
        });
      },
      recentMessages: () => ctx.messageStore.listRecent(50),
      ...(pushVapid && pushStore ? { push: { vapid: pushVapid, store: pushStore } } : {}),
    });
  }

  // --- Vigili Cloud Relay への outbound WSS (Phase 14-B) ---
  let relay: RelayClient | null = null;
  if (config.relay) {
    // クロージャ参照のため宣言は前置きしておく (TS の hoisting に頼らず、later assignment)
    let sendSnapshot: (() => void) | null = null;
    relay = createRelayClient({
      url: config.relay.url,
      pairingId: config.relay.pairing_id,
      agentKey: config.relay.agent_key,
      reconnectMaxSeconds: config.relay.reconnect_max_seconds,
      onClientMessage: handleClientMessage,
      onOpen: () => sendSnapshot?.(),
      log,
    });
    const relayRef = relay; // satisfy strict-null-checks within closure
    sendSnapshot = () => {
      relayRef.send({
        type: "snapshot",
        pending: queue.list(),
        messages: messageStore.listRecent(50),
      });
    };
    relay.start();
    log(`[vigili-daemon] relay outbound enabled (pairing=${config.relay.pairing_id})`);
  }

  // pending / resolved / messages は LAN WS と Relay の両方に同時 broadcast する。
  const broadcastAll = (msg: import("@vigili/shared").WsServerMessage): void => {
    ws?.broadcast(msg);
    relay?.send(msg);
  };

  // queue のイベントを LAN WS は内部 listener で捕まえてるが、relay の方には別途流す必要がある。
  // 二重送信を避けるため LAN WS の onPending/onResolved 経路を残しつつ、relay には
  // 独自に subscribe する。
  if (relay) {
    queue.onPending((req) => relay?.send({ type: "pending", request: req }));
    queue.onResolved((id, decision) => relay?.send({ type: "resolved", id, decision }));
  }

  // ctx の broadcast コールバックを実体に差し替える (LAN + Relay 同時)
  ctx.onMessageAdded = (m) => broadcastAll({ type: "message-added", message: m });
  ctx.onMessageDelivered = (id, delivered_at) =>
    broadcastAll({ type: "message-delivered", id, delivered_at });

  // SIGHUP で policy をホットリロード (CLI / launchd 経由で利用可)
  const sigHandler = (): void => {
    void reloadPolicy(ctx);
  };
  process.on("SIGHUP", sigHandler);

  // DB の容量管理: 起動直後に 1 回 + 6 時間ごとに走らせる。
  // CLAUDE.md: 100MB 超で 30 日以前削除。
  const ARCHIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const MAX_DB_BYTES = 100 * 1024 * 1024;
  const OLDER_THAN_MS = 30 * 24 * 60 * 60 * 1000;
  const runArchive = (): void => {
    try {
      const { db, path: dbPath } = store.raw();
      const result = pruneOldRequests(db, dbPath, {
        maxBytes: MAX_DB_BYTES,
        olderThanMs: OLDER_THAN_MS,
        fs: { statSync },
      });
      if (result.pruned > 0) {
        log(
          `[vigili-daemon] archive: pruned ${result.pruned} rows ` +
            `(${(result.sizeBefore / 1024 / 1024).toFixed(1)} → ${(result.sizeAfter / 1024 / 1024).toFixed(1)} MB)`,
        );
      }
    } catch (err) {
      log(`[vigili-daemon] archive 失敗: ${(err as Error).message}`);
    }
  };
  runArchive();
  const archiveTimer = setInterval(runArchive, ARCHIVE_INTERVAL_MS);

  return {
    store,
    socket,
    ws,
    queue,
    token,
    close: async () => {
      process.off("SIGHUP", sigHandler);
      clearInterval(archiveTimer);
      queue.cancelAll("daemon shutdown");
      await socket.close();
      if (ws) await ws.close();
      if (relay) await relay.stop();
      store.close();
    },
  };
}

async function reloadPolicy(ctx: DaemonContext): Promise<void> {
  try {
    const fresh = await loadPolicyFile(ctx.policyPath);
    ctx.policy = fresh;
    ctx.log(`[vigili-daemon] policy reloaded (${fresh.rules.length} rules including generated)`);
  } catch (err) {
    ctx.log(`[vigili-daemon] policy reload 失敗: ${(err as Error).message}`);
  }
}

async function handlePromote(promote: PromoteRule, ctx: DaemonContext): Promise<void> {
  try {
    const rule = promoteToRule(promote, "human:ws");
    await appendGeneratedRule(ctx.generatedPolicyPath, rule);
    ctx.log(`[vigili-daemon] promoted rule "${rule.name}" → ${ctx.generatedPolicyPath}`);
    await reloadPolicy(ctx);
  } catch (err) {
    ctx.log(`[vigili-daemon] promote 失敗: ${(err as Error).message}`);
  }
}

/**
 * 初回起動時の救済: ~/.vigili/policy.yaml が無ければ default.ts の埋め込み
 * を書き出して、newcomer がいきなり「policy.yaml を読めません」で詰まないようにする。
 * 親ディレクトリも無ければ作る。
 */
async function ensureDefaultPolicy(
  policyPath: string,
  log: (msg: string) => void,
): Promise<void> {
  if (existsSync(policyPath)) return;
  const dir = dirname(policyPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  await writeFile(policyPath, DEFAULT_POLICY_YAML, { encoding: "utf-8", mode: 0o600 });
  log(`[vigili-daemon] ${policyPath} が無かったのでデフォルトを書き出しました`);
}

function resolveNotifier(
  options: DaemonOptions,
  config: SentinelConfig,
  log: (msg: string) => void,
  pushVapid: VapidKeys | null,
  pushStore: SubscriptionStore | null,
): Notifier {
  if (options.notifier) return options.notifier;

  const notifiers: Notifier[] = [];

  if (pushVapid && pushStore) {
    notifiers.push(
      createWebPushNotifier({
        vapid: pushVapid,
        store: pushStore,
        log,
        ...(config.pwa.base_url !== undefined ? { pwaBaseUrl: config.pwa.base_url } : {}),
      }),
    );
  }

  if (config.ntfy) {
    notifiers.push(
      createNtfyNotifier(
        {
          server: config.ntfy.server,
          topic: config.ntfy.topic,
          priority: {
            normal: config.ntfy.priority_map.normal,
            critical: config.ntfy.priority_map.critical,
          },
          ...(config.pwa.base_url !== undefined ? { pwaBaseUrl: config.pwa.base_url } : {}),
        },
        undefined,
        log,
      ),
    );
  }

  if (notifiers.length === 0) return NULL_NOTIFIER;
  return multiNotifier(notifiers);
}

interface DaemonContext {
  /** ホットリロード可能なため mutable。reloadPolicy() で差し替える。 */
  policy: PolicyConfig;
  store: RequestStore;
  messageStore: MessageStore;
  queue: PendingQueue;
  sessionTags: Record<string, string>;
  notifier: Notifier;
  log: (msg: string) => void;
  policyPath: string;
  generatedPolicyPath: string;
  /** WS から PWA に message-added / message-delivered を broadcast するコールバック。
   *  WS server が起動後に差し替える。startDaemon の構築時点では noop。 */
  onMessageAdded: (m: import("@vigili/shared").Message) => void;
  onMessageDelivered: (id: string, delivered_at: number) => void;
}

async function handleLine(line: string, conn: ConnContext, ctx: DaemonContext): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    conn.send({ decision: "deny", reason: "invalid JSON" } satisfies Decision);
    return;
  }

  if (isAdmin(parsed)) {
    await handleAdmin(parsed, conn, ctx);
    return;
  }

  await handleToolRequest(parsed, conn, ctx);
}

function isAdmin(value: unknown): value is { kind: "admin" } {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "admin"
  );
}

async function handleAdmin(value: unknown, conn: ConnContext, ctx: DaemonContext): Promise<void> {
  const result = AdminRequestSchema.safeParse(value);
  if (!result.success) {
    const resp: AdminResponse = {
      kind: "admin",
      action: "resolve", // 不明なときは resolve action で error を返す
      ok: false,
      error: `不正な admin リクエスト: ${result.error.issues.map((i) => i.message).join("; ")}`,
    };
    conn.send(resp);
    return;
  }
  const req = result.data;
  if (req.action === "pending") {
    const resp: AdminResponse = {
      kind: "admin",
      action: "pending",
      ok: true,
      pending: ctx.queue.list(),
    };
    conn.send(resp);
    return;
  }
  if (req.action === "reload") {
    await reloadPolicy(ctx);
    const resp: AdminResponse = {
      kind: "admin",
      action: "reload",
      ok: true,
      rules: ctx.policy.rules.length,
    };
    conn.send(resp);
    return;
  }
  if (req.action === "stats") {
    // from_ms / to_ms 省略時は「今日 (00:00 ローカル) 〜 現在 + 60s」。
    // 今日のサマリーを聞きたい用途が大半なのでこれをデフォルトに据える。
    const now = Date.now();
    const fromMs = req.from_ms ?? startOfTodayLocalMs(now);
    const toMs = req.to_ms ?? now + 60_000;
    const stats = computeStats(ctx.store.raw().db, fromMs, toMs);
    const resp: AdminResponse = {
      kind: "admin",
      action: "stats",
      ok: true,
      stats,
    };
    conn.send(resp);
    return;
  }
  // resolve
  const ok = ctx.queue.resolve(req.id, req.decision, "human:cli", req.reason ?? null);
  const resp: AdminResponse = ok
    ? { kind: "admin", action: "resolve", ok: true }
    : {
        kind: "admin",
        action: "resolve",
        ok: false,
        error: `id ${req.id} は pending にありません (既に決着 / タイムアウト / 未知)`,
      };
  conn.send(resp);
}

async function handleToolRequest(
  parsed: unknown,
  conn: ConnContext,
  ctx: DaemonContext,
): Promise<void> {
  const reqResult = ToolRequestSchema.safeParse(parsed);
  if (!reqResult.success) {
    conn.send({ decision: "deny", reason: "invalid ToolRequest" } satisfies Decision);
    return;
  }
  const req = reqResult.data;

  const id = randomUUID();
  const now = Date.now();
  const sessionTag = req.session_tag ?? null;

  ctx.store.insert({
    id,
    created_at: now,
    session_id: req.session_id,
    session_tag: sessionTag,
    tool_name: req.tool_name,
    tool_input: req.tool_input,
    cwd: req.cwd,
  });

  const result = decide(req, ctx.policy, { sessionTags: ctx.sessionTags });

  // この session 宛にキューされているメッセージを drain し、Decision に同梱する。
  // session_id 未指定 (gate が --session 渡さなかった) なら drain しない。
  const drained =
    req.session_id !== undefined && req.session_id !== ""
      ? ctx.messageStore.drainForSession(req.session_id, Date.now())
      : [];
  for (const m of drained) {
    if (m.delivered_at !== null) ctx.onMessageDelivered(m.id, m.delivered_at);
  }

  if (result.action !== "ask") {
    finalizeImmediate(id, result, ctx);
    conn.send(toDecisionResponse(result, drained));
    return;
  }

  // ask: ID を gate に知らせ、resolution を待つ。
  // drained messages は ask resolution に同梱する (ここでは送らない)。
  conn.send({ decision: "ask", request_id: id } satisfies Decision);

  const approvalRow = ctx.store.get(id);
  if (!approvalRow) {
    // 直前に insert したのでまずあり得ないが、防御的にハンドル
    ctx.store.resolve({
      id,
      resolved_at: Date.now(),
      decision: "deny",
      decided_by: "internal:store-miss",
      reason: "ask 処理中に DB から消えました",
    });
    conn.send({
      request_id: id,
      decision: "deny",
      reason: "internal store miss",
    } satisfies AskResolution);
    return;
  }

  // gate が早期切断した場合は queue から消して終了する。
  conn.onClose(() => {
    if (ctx.queue.has(id)) {
      ctx.queue.resolve(id, "deny", "cancelled:gate-disconnected", "gate が応答待ち中に切断");
    }
  });

  // ntfy 通知 (fire-and-forget)。result.notify が無ければ "normal"。
  void ctx.notifier.notify({
    request: approvalRow,
    level: result.notify ?? "normal",
    ruleSource: result.source,
  });

  const timeoutMs = ctx.policy.defaults.timeout_seconds * 1000;
  const resolution = await ctx.queue.enroll(approvalRow, timeoutMs);
  persistResolution(id, resolution, result, ctx);

  if (!conn.isClosed()) {
    const payload: AskResolution = {
      request_id: id,
      decision: resolution.decision,
      ...(resolution.reason !== null ? { reason: resolution.reason } : {}),
      ...(drained.length > 0 ? { messages: drained } : {}),
    };
    conn.send(payload);
  }
}

function finalizeImmediate(id: string, result: DecisionResult, ctx: DaemonContext): void {
  ctx.store.resolve({
    id,
    resolved_at: Date.now(),
    decision: result.action === "allow" ? "allow" : "deny",
    decided_by: result.source,
    reason: result.reason ?? null,
  });
}

function persistResolution(
  id: string,
  resolution: Resolution,
  policyHit: DecisionResult,
  ctx: DaemonContext,
): void {
  ctx.store.resolve({
    id,
    resolved_at: Date.now(),
    decision: resolution.decision,
    decided_by: `${resolution.source} (policy:${policyHit.source})`,
    reason: resolution.reason,
  });
}

function toDecisionResponse(
  result: DecisionResult,
  messages: import("@vigili/shared").Message[] = [],
): Decision {
  if (result.action === "allow") {
    return {
      decision: "allow",
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      ...(messages.length > 0 ? { messages } : {}),
    };
  }
  return {
    decision: "deny",
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(messages.length > 0 ? { messages } : {}),
  };
}

/** 当日 00:00:00 (ローカル時刻) を UNIX ms で返す。 */
function startOfTodayLocalMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
