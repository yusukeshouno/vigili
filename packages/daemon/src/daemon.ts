import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ApprovalRequest,
  type AskMode,
  type AskResolution,
  type Decision,
  type HostedSession,
  type PolicyConfig,
  type PromoteRule,
  type SessionDaemonMessage,
  type SessionRunnerMessage,
  SessionRunnerMessageSchema,
  type ToolRequest,
  ToolRequestSchema,
  type WsClientMessage,
  type WsServerMessage,
} from "@vigili/shared";
import {
  type RelayConfigSection,
  type SentinelConfig,
  loadConfigFile,
  removeRelayConfig,
  writeRelayConfig,
} from "./config.js";
import { type MessageStore, createMessageStore } from "./db/messages.js";
import { computeStats, computeWeekStats, pruneOldRequests } from "./db/stats.js";
import { type RequestStore, openStore } from "./db/store.js";
import { createNtfyNotifier } from "./notify/ntfy.js";
import { NULL_NOTIFIER, type Notifier, multiNotifier } from "./notify/types.js";
import {
  type SubscriptionStore,
  type VapidKeys,
  createWebPushNotifier,
  loadOrCreateVapidKeys,
  openSubscriptionStore,
} from "./notify/web-push.js";
import { loadAskMode, saveAskMode } from "./ask-mode.js";
import { paths } from "./paths.js";
import { DEFAULT_POLICY_YAML } from "./policy/default.js";
import { type DecisionResult, decide } from "./policy/engine.js";
import { inferRepoTag } from "./policy/extractors.js";
import { loadPolicyFile } from "./policy/loader.js";
import { appendGeneratedRule, loadGeneratedRules, promoteToRule } from "./policy/promote.js";
import { type PendingQueue, type Resolution, createPendingQueue } from "./queue.js";
import { AdminRequestSchema, type AdminResponse } from "./server/admin.js";
import { type RelayClient, createRelayClient } from "./server/relay-client.js";
import { type ConnContext, type SocketServer, startSocketServer } from "./server/socket.js";
import { type RunningWsServer, startWsServer } from "./server/ws.js";
import { type SessionRegistry, createSessionRegistry } from "./sessions.js";
import { sweepStalePending } from "./sweep.js";
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
  /** observed session の idle TTL (ms)。テスト用。デフォルトは config 値 (30 分)。 */
  sessionIdleTtlMs?: number;
  /** notifier を差し替えたい場合 (テスト用)。 */
  notifier?: Notifier;
  /** WS サーバを起動するか。テストでは false にできる。 */
  enableWs?: boolean;
  /** WS サーバの port。デフォルト config.daemon.ws_port (7878)。 */
  wsPort?: number;
  /** WS サーバの host。デフォルト config.daemon.ws_host (127.0.0.1)。 */
  wsHost?: string;
  /** pending TTL sweep の TTL (ms)。省略時は config.daemon.pending_ttl_seconds。テスト用。 */
  pendingTtlMs?: number;
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
  const initialPolicy = options.policy ?? (await loadPolicyFile(p.policy, log));
  const config = options.config ?? (await loadConfigFile(p.config));
  const store = openStore(p.db);
  // messages テーブルは queue.db に同居する (small, single DB で OK)
  const messageStore = createMessageStore(store.raw().db);
  const queue = createPendingQueue();
  const sessions = createSessionRegistry();
  const token = loadOrCreateToken(p.token);

  // 待機画面サマリー用の「今日 (ローカル 00:00 〜 現在 +60s)」集計。
  // WS の snapshot 直後と、resolved / sweep のたびにクライアントへ push する。
  const todayStats = (): import("@vigili/shared").StatsBuckets => {
    const now = Date.now();
    return computeStats(store.raw().db, startOfTodayLocalMs(now), now + 60_000);
  };
  // 週次バケット: 決着/sweep のたびに再計算して push する。
  // computeStats 7 回呼び出しだが各クエリは軽量 (1 日分のフィルタ)。
  const weekStats = () => computeWeekStats(store.raw().db, Date.now());

  // Web Push: 有効なら VAPID 鍵 + subscription store を用意する。
  // notifier はその後で組み立てる (ntfy と並列に走らせる場合あり)。
  let pushVapid: VapidKeys | null = null;
  let pushStore: SubscriptionStore | null = null;
  if (config.push.enabled) {
    pushVapid = loadOrCreateVapidKeys(p.vapid, config.push.subject);
    pushStore = openSubscriptionStore(p.pushSubs);
    log(`[vigili-daemon] web-push ready (subs=${pushStore.size()}, vapid=${p.vapid})`);
  }

  const notifier = resolveNotifier(options, config, log, pushVapid, pushStore);

  const sessionTags = options.sessionTags ?? config.session_tags;

  // ask ルーティングモード (SPEC §2.6)。ファイルで再起動を跨いで維持する。
  let askMode: AskMode = loadAskMode(p.askMode);
  if (askMode !== "integrated") {
    log(`[vigili-daemon] ask-mode: ${askMode}`);
  }

  // policy はホットリロード可能にするため mutable な参照で持つ。
  const ctx: DaemonContext = {
    policy: initialPolicy,
    store,
    messageStore,
    queue,
    sessions,
    sessionTags,
    notifier,
    log,
    policyPath: p.policy,
    generatedPolicyPath: p.policyGenerated,
    broadcast: () => {},
    reconfigureRelay: () => false,
    disconnectRelay: async () => {},
    onMessageAdded: () => {},
    onMessageDelivered: () => {},
    askMode: () => askMode,
    setAskMode: (mode) => {
      if (mode === askMode) return;
      askMode = mode;
      try {
        saveAskMode(p.askMode, mode);
      } catch (err) {
        log(`[vigili-daemon] ask-mode 永続化失敗: ${(err as Error).message}`);
      }
      log(`[vigili-daemon] ask-mode → ${mode}`);
      ctx.broadcast({ type: "ask-mode", mode });
    },
  };

  const socket = startSocketServer(p.socket, (line, conn) => handleLine(line, conn, ctx));
  log(`[vigili-daemon] listening on ${p.socket}`);

  // PWA/iOS から飛んでくる client メッセージ (decide / send-message) を捌くロジックは
  // LAN WS と Relay の両方から呼ぶので関数化しておく。
  const handleClientMessage = (msg: WsClientMessage): void => {
    if (msg.type === "decide") {
      if (msg.promote) void handlePromote(msg.promote, ctx);
      const ok = queue.resolve(msg.id, msg.decision, "human:relay", null);
      if (!ok) log(`[vigili-relay] decide: id ${msg.id} は既に決着済み / 未知`);
    } else if (msg.type === "set-ask-mode") {
      ctx.setAskMode(msg.mode);
    } else if (msg.type === "send-message") {
      const id = randomUUID();
      const stored = ctx.messageStore.insert({
        id,
        session_id: msg.session_id,
        body: msg.body,
        created_at: Date.now(),
      });
      ctx.onMessageAdded(stored);
    } else {
      // answer-question / decide-plan / session-reply (L4 ホスト型セッション)
      handleSessionClientMessage(msg, ctx);
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
      currentSessions: () => ctx.sessions.list(),
      currentStats: todayStats,
      onSessionClient: (msg) => handleSessionClientMessage(msg, ctx),
      askMode: () => ctx.askMode(),
      onSetAskMode: (mode) => ctx.setAskMode(mode),
      ...(pushVapid && pushStore ? { push: { vapid: pushVapid, store: pushStore } } : {}),
    });
  }

  // WS リスナーが bind できた後にだけ PID file を書く。bind 前に書くと、
  // EADDRINUSE で落ちた瞬間に「ポートを掴んでいる生存プロセスが別に居るのに
  // pidfile は死んだ PID を指す」状態になり、次の起動で stale 判定 → 再 bind 失敗
  // という launchd 再起動ループ (relay agent が flap し iOS リモートが切れる) を誘発する。
  await writeFile(p.pid, String(process.pid), { mode: 0o600 });

  // --- Vigili Cloud Relay への outbound WSS (Phase 14-B / ホット再設定対応) ---
  // relay は起動時に config.relay があれば即接続するが、無くても後から Mac アプリの
  // 「Sign in with Apple」(= relay-configure admin) で接続できるよう、関連配線は常時行い、
  // mutable な `relay` ref を null 安全 (`relay?.`) に参照する。
  let relay: RelayClient | null = null;

  function buildRelay(cfg: RelayConfigSection): RelayClient {
    // クロージャ参照のため sendSnapshot は later assignment。
    let sendSnapshot: (() => void) | null = null;
    const client = createRelayClient({
      url: cfg.url,
      pairingId: cfg.pairing_id,
      agentKey: cfg.agent_key,
      reconnectMaxSeconds: cfg.reconnect_max_seconds ?? 15,
      onClientMessage: handleClientMessage,
      onOpen: () => sendSnapshot?.(),
      onRefreshSnapshot: () => sendSnapshot?.(),
      log,
    });
    sendSnapshot = () => {
      client.send({
        type: "snapshot",
        pending: queue.list(),
        messages: messageStore.listRecent(50),
        sessions: sessions.list(),
      });
      client.send({ type: "stats", stats: todayStats(), week: weekStats() });
    };
    return client;
  }

  if (config.relay) {
    relay = buildRelay(config.relay);
    relay.start();
    log(`[vigili-daemon] relay outbound enabled (pairing=${config.relay.pairing_id})`);
  }

  // pending / resolved / messages は LAN WS と Relay の両方に同時 broadcast する。
  const broadcastAll = (msg: WsServerMessage): void => {
    ws?.broadcast(msg);
    relay?.send(msg);
  };
  // セッションハンドラ (handleSessionMessage) からも broadcast できるよう ctx に載せる。
  ctx.broadcast = broadcastAll;

  // gate 由来 observed session の status を pending の有無から再評価する (SPEC §8.5.1)。
  // pending あり→awaiting / なし→running。onResolved は後段の snapshot 購読 (下) が
  // 最新 status を運ぶので、ここでは状態だけ直す。onPending は snapshot 購読が無いため
  // 変化があれば自前で snapshot を流す。※購読順が意味を持つ: ここは snapshot 購読より先。
  const reevaluateObservedSessions = (broadcastOnChange: boolean): void => {
    const pendingSids = new Set(queue.list().map((r) => r.session_id));
    const changed = sessions.reevaluateObserved(pendingSids);
    if (broadcastOnChange && changed.length > 0) {
      broadcastAll({
        type: "snapshot",
        pending: queue.list(),
        messages: messageStore.listRecent(50),
        sessions: sessions.list(),
      });
    }
  };
  queue.onPending(() => reevaluateObservedSessions(true));
  queue.onResolved(() => reevaluateObservedSessions(false));

  // 決着のたびに今日の集計を作り直して push する (待機画面サマリーを最新に保つ)。
  // allow/deny カウントが動くのは resolve の瞬間なので、ここが主要な更新点。
  queue.onResolved(() => broadcastAll({ type: "stats", stats: todayStats(), week: weekStats() }));

  // relay へ pending/resolved を流す subscription は relay の有無に関わらず常時張る
  // (relay が null の間は relay?.send が no-op)。後から relay-configure で接続しても効く。
  queue.onPending((req) => relay?.send({ type: "pending", request: req }));
  // resolved はローカル WS クライアント (iOS/Mac LAN) と relay の両方へ送る。
  // broadcastAll は ws?.broadcast + relay?.send の両方を呼ぶので一箇所で済む。
  queue.onResolved((id, decision) => broadcastAll({ type: "resolved", id, decision }));
  // ベルト＆サスペンダー: resolved のたびに現在の pending 全件を snapshot で送る。
  // "resolved" メッセージを見逃したクライアント (relay 瞬断・LAN 再接続) も
  // この snapshot で確実に stale item が消える。
  // empty 判定はしない — 複数 pending 中の 1 件が resolved になるケースも含む。
  queue.onResolved(() => {
    broadcastAll({
      type: "snapshot",
      pending: queue.list(),
      messages: messageStore.listRecent(50),
      sessions: sessions.list(),
    });
  });

  // --- LAN 外 (relay 経路) で承認が飛んでこない問題の対策 ---
  // pending が 1 件以上残っている間だけ relay へ snapshot を周期再送する (後から接続した
  // client も数秒以内に現在のキューを受け取れる)。relay 未接続/未構築のときは内部ガードで no-op。
  const RELAY_SNAPSHOT_INTERVAL_MS = 3000;
  const relaySnapshotTimer: NodeJS.Timeout = setInterval(() => {
    const r = relay;
    if (!r?.isConnected()) return;
    const pending = queue.list();
    if (pending.length === 0) return;
    r.send({
      type: "snapshot",
      pending,
      messages: messageStore.listRecent(50),
      sessions: sessions.list(),
    });
  }, RELAY_SNAPSHOT_INTERVAL_MS);

  // Mac アプリの「Sign in with Apple」→ relay-configure admin から呼ばれる。
  // config.yaml に永続化し、relay をプロセス再起動なしで (再)接続する。
  ctx.reconfigureRelay = (cfg) => {
    writeRelayConfig(p.config, {
      url: cfg.url,
      pairing_id: cfg.pairing_id,
      agent_key: cfg.agent_key,
      reconnect_max_seconds: cfg.reconnect_max_seconds,
    });
    if (relay === null) {
      relay = buildRelay(cfg);
      relay.start();
      log(`[vigili-daemon] relay outbound enabled via sign-in (pairing=${cfg.pairing_id})`);
    } else {
      relay.reconfigure({
        url: cfg.url,
        pairingId: cfg.pairing_id,
        agentKey: cfg.agent_key,
        reconnectMaxSeconds: cfg.reconnect_max_seconds,
      });
      log(`[vigili-daemon] relay reconfigured via sign-in (pairing=${cfg.pairing_id})`);
    }
    return relay.isConnected();
  };

  // Mac アプリの「Logout」→ relay-disconnect admin から呼ばれる。
  // relay 接続を停止し config.yaml の relay 節を消す (LAN 経路は維持)。
  ctx.disconnectRelay = async () => {
    if (relay) {
      await relay.stop();
      relay = null;
    }
    removeRelayConfig(p.config);
    log("[vigili-daemon] relay disconnected via logout");
  };

  // ctx の broadcast コールバックを実体に差し替える (LAN + Relay 同時)
  ctx.onMessageAdded = (m) => broadcastAll({ type: "message-added", message: m });
  ctx.onMessageDelivered = (id, delivered_at) =>
    broadcastAll({ type: "message-delivered", id, delivered_at });

  // pending TTL sweep: gate が諦めても decision IS NULL のまま残った zombie を
  // 起動直後に 1 回 + 60 秒ごとに回収して expired に確定させる。回収したら
  // 最新 snapshot を再送し、アプリの「pending カード」を消す (待機画面に戻す)。
  const SWEEP_INTERVAL_MS = 60 * 1000;
  const pendingTtlMs = options.pendingTtlMs ?? config.daemon.pending_ttl_seconds * 1000;
  const sessionIdleTtlMs =
    options.sessionIdleTtlMs ?? config.daemon.session_idle_ttl_seconds * 1000;
  const runSweep = (): void => {
    try {
      const now = Date.now();
      const swept = sweepStalePending({ store, queue, now, ttlMs: pendingTtlMs });
      // gate 由来 observed session の idle 終了 (SPEC §8.5.1)。hosted は対象外。
      const endedSessions = sessions.sweepIdleObserved(now, sessionIdleTtlMs);
      for (const s of endedSessions) {
        broadcastAll({ type: "session-ended", session_id: s.session_id, reason: "idle" });
      }
      if (swept.length === 0 && endedSessions.length === 0) return;
      broadcastAll({
        type: "snapshot",
        pending: queue.list(),
        messages: messageStore.listRecent(50),
        sessions: sessions.list(),
      });
      if (swept.length > 0) {
        broadcastAll({ type: "stats", stats: todayStats(), week: weekStats() });
        log(`[vigili-daemon] sweep: expired ${swept.length} stale pending request(s)`);
      }
      if (endedSessions.length > 0) {
        log(`[vigili-daemon] sweep: idle-ended ${endedSessions.length} observed session(s)`);
      }
    } catch (err) {
      log(`[vigili-daemon] sweep 失敗: ${(err as Error).message}`);
    }
  };
  runSweep();
  const sweepTimer = setInterval(runSweep, SWEEP_INTERVAL_MS);

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

  // 日次サマリー通知: JST 20:00 に今日の自動処理件数をプッシュ通知する
  let lastDigestDate = "";
  const runDailyDigest = (): void => {
    try {
      // JST = UTC+9
      const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const hhmm = `${String(nowJst.getUTCHours()).padStart(2, "0")}:${String(nowJst.getUTCMinutes()).padStart(2, "0")}`;
      const dateStr = nowJst.toISOString().slice(0, 10); // "YYYY-MM-DD"
      if (hhmm !== "20:00" || dateStr === lastDigestDate) return;
      lastDigestDate = dateStr;

      // 今日の JST 0:00 〜 今の集計
      const midnightJstMs = new Date(`${dateStr}T00:00:00+09:00`).getTime();
      const stats = computeStats(store.raw().db, midnightJstMs, Date.now());
      const autoAllow = (stats.by_source["auto-rule"] ?? 0) + (stats.by_source["invariant"] ?? 0);
      const humanAllow = stats.by_source["human-pwa"] ?? 0;
      const total = stats.by_decision.allow + stats.by_decision.deny;

      if (total === 0) return; // 何も起きていない日は通知しない

      const body =
        `自動承認 ${autoAllow} 件 · 手動承認 ${humanAllow} 件` +
        (stats.by_decision.deny > 0 ? ` · ブロック ${stats.by_decision.deny} 件` : "");
      void notifier.send({
        title: "Vigili 本日のサマリー",
        body,
        tag: "daily-digest",
        urgency: "normal",
      });
      log(`[vigili-daemon] daily digest 通知 (${body})`);
    } catch (err) {
      log(`[vigili-daemon] daily digest 失敗: ${(err as Error).message}`);
    }
  };
  const digestTimer = setInterval(runDailyDigest, 60 * 1000); // 1分ごとにチェック

  return {
    store,
    socket,
    ws,
    queue,
    token,
    close: async () => {
      process.off("SIGHUP", sigHandler);
      clearInterval(sweepTimer);
      clearInterval(archiveTimer);
      clearInterval(digestTimer);
      clearInterval(relaySnapshotTimer);
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
    const fresh = await loadPolicyFile(ctx.policyPath, ctx.log);
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
async function ensureDefaultPolicy(policyPath: string, log: (msg: string) => void): Promise<void> {
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
  /** L4 ホスト型セッション (vigili run) のレジストリ。 */
  sessions: SessionRegistry;
  sessionTags: Record<string, string>;
  notifier: Notifier;
  log: (msg: string) => void;
  policyPath: string;
  generatedPolicyPath: string;
  /** WS + relay に WsServerMessage を同時 broadcast する。WS/relay 構築後に差し替える。 */
  broadcast: (msg: WsServerMessage) => void;
  /**
   * relay の接続先 (url/pairing/agent_key) を config.yaml に永続化し、プロセス再起動なしで
   * relay client を (再)接続する。relay 構築後に実体へ差し替える。戻り値は試行直後の接続状態。
   */
  reconfigureRelay: (cfg: RelayConfigSection) => boolean;
  /** relay 接続を停止し config.yaml の relay 節を削除する (ログアウト)。LAN 経路は維持。 */
  disconnectRelay: () => Promise<void>;
  /** WS から PWA に message-added / message-delivered を broadcast するコールバック。
   *  WS server が起動後に差し替える。startDaemon の構築時点では noop。 */
  onMessageAdded: (m: import("@vigili/shared").Message) => void;
  onMessageDelivered: (id: string, delivered_at: number) => void;
  /** ask ルーティングモード (SPEC §2.6)。daemon が単一の真実として持つ。 */
  askMode: () => AskMode;
  /** モードを切り替えて永続化し、全クライアントに broadcast する。 */
  setAskMode: (mode: AskMode) => void;
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

  if (isSession(parsed)) {
    await handleSessionMessage(parsed, conn, ctx);
    return;
  }

  await handleToolRequest(parsed, conn, ctx);
}

function isAdmin(value: unknown): value is { kind: "admin" } {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "admin"
  );
}

function isSession(value: unknown): value is { kind: "session" } {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "session"
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
  if (req.action === "relay-configure") {
    let connected = false;
    try {
      connected = ctx.reconfigureRelay({
        url: req.url,
        pairing_id: req.pairing_id,
        agent_key: req.agent_key,
        reconnect_max_seconds: req.reconnect_max_seconds,
      });
    } catch (err) {
      conn.send({
        kind: "admin",
        action: "relay-configure",
        ok: false,
        error: (err as Error).message,
      } satisfies AdminResponse);
      return;
    }
    conn.send({
      kind: "admin",
      action: "relay-configure",
      ok: true,
      connected,
    } satisfies AdminResponse);
    return;
  }
  if (req.action === "relay-disconnect") {
    try {
      await ctx.disconnectRelay();
    } catch (err) {
      conn.send({
        kind: "admin",
        action: "relay-disconnect",
        ok: false,
        error: (err as Error).message,
      } satisfies AdminResponse);
      return;
    }
    conn.send({ kind: "admin", action: "relay-disconnect", ok: true } satisfies AdminResponse);
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
  if (req.action === "rules") {
    // 現在メモリに載っているルール一覧 + generated ファイルのルール名を返す。
    const generatedNames = await loadGeneratedRules(ctx.generatedPolicyPath).then(
      (rules) => rules.map((r) => r.name),
      () => [] as string[],
    );
    const resp: AdminResponse = {
      kind: "admin",
      action: "rules",
      ok: true,
      rules: ctx.policy.rules,
      generatedRuleNames: generatedNames,
    };
    conn.send(resp);
    return;
  }
  if (req.action === "history") {
    const limit = req.limit ?? 100;
    const db = ctx.store.raw().db;
    interface HistRow {
      id: string;
      created_at: number;
      resolved_at: number | null;
      tool_name: string;
      tool_input: string;
      decision: string;
      decided_by: string;
    }
    const rows = db
      .prepare<[], HistRow>(
        `SELECT id, created_at, resolved_at, tool_name, tool_input, decision, decided_by
         FROM approval_requests
         WHERE decided_by LIKE 'policy:%' AND decision IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ${limit}`,
      )
      .all();
    const items = rows.map((r) => {
      let summary = "";
      try {
        const inp = JSON.parse(r.tool_input) as Record<string, unknown>;
        summary =
          (inp["command"] as string | undefined) ??
          (inp["path"] as string | undefined) ??
          (inp["url"] as string | undefined) ??
          JSON.stringify(inp).slice(0, 80);
      } catch {
        summary = r.tool_input.slice(0, 80);
      }
      const ruleName = r.decided_by.startsWith("policy:")
        ? r.decided_by.slice("policy:".length)
        : r.decided_by;
      return {
        id: r.id,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        tool_name: r.tool_name,
        tool_input_summary: summary,
        decision: r.decision as "allow" | "deny",
        rule_name: ruleName,
      };
    });
    const resp: AdminResponse = { kind: "admin", action: "history", ok: true, items };
    conn.send(resp);
    return;
  }
  if (req.action === "rule-delete") {
    try {
      const existing = await loadGeneratedRules(ctx.generatedPolicyPath);
      const found = existing.some((r) => r.name === req.name);
      if (!found) {
        const resp: AdminResponse = {
          kind: "admin",
          action: "rule-delete",
          ok: false,
          error: `generated rule "${req.name}" が見つかりません`,
        };
        conn.send(resp);
        return;
      }
      const filtered = existing.filter((r) => r.name !== req.name);
      const { stringify: stringifyYaml } = await import("yaml");
      const HEADER = `# Auto-generated by Vigili.\n#\n# このファイルは PWA で "Allow & promote to rule" を押すたびに追記されます。\n`;
      const body = stringifyYaml({ rules: filtered }, { lineWidth: 0 });
      const content = `${HEADER}\n${body}`;
      const { writeFile, rename } = await import("node:fs/promises");
      const tmp = `${ctx.generatedPolicyPath}.${process.pid}.tmp`;
      await writeFile(tmp, content, { mode: 0o600 });
      await rename(tmp, ctx.generatedPolicyPath);
      await reloadPolicy(ctx);
      ctx.log(`[vigili-daemon] deleted generated rule "${req.name}"`);
      const resp: AdminResponse = { kind: "admin", action: "rule-delete", ok: true };
      conn.send(resp);
      return;
    } catch (err) {
      const resp: AdminResponse = {
        kind: "admin",
        action: "rule-delete",
        ok: false,
        error: (err as Error).message,
      };
      conn.send(resp);
      return;
    }
  }
  if (req.action === "policy-catalog") {
    const { POLICY_CATALOG } = await import("./policy/default.js");
    const resp: AdminResponse = {
      kind: "admin",
      action: "policy-catalog",
      ok: true,
      items: POLICY_CATALOG.map((e) => ({
        id: e.id,
        category: e.category,
        label: e.label,
        description: e.description,
        detail: e.detail,
        ...(e.caution !== undefined ? { caution: e.caution } : {}),
      })),
    };
    conn.send(resp);
    return;
  }
  if (req.action === "policy-write-from-catalog") {
    try {
      const { POLICY_CATALOG, MINIMAL_POLICY_YAML } = await import("./policy/default.js");
      const { stringify: stringifyYaml, parse: parseYaml } = await import("yaml");
      const selected = new Set(req.selected_ids);
      const rules = POLICY_CATALOG.filter((e) => selected.has(e.id)).map((e) => e.rule);

      // 書き込み前に invariant / 正規表現の検証を通す。検証せず保存すると、
      // reload は in-memory の旧ポリシーで動き続ける一方、次回起動時に
      // ロード失敗 → 起動ループに陥る (フェイルセーフ deny で全リクエスト停止)。
      {
        const { PolicyConfigSchema } = await import("@vigili/shared");
        const { validatePolicyAgainstInvariants, validatePolicyRegexes } = await import(
          "./policy/loader.js"
        );
        const base = parseYaml(MINIMAL_POLICY_YAML) as { defaults: unknown };
        const candidate = PolicyConfigSchema.parse({ defaults: base.defaults, rules });
        validatePolicyRegexes(candidate);
        validatePolicyAgainstInvariants(candidate);
      }

      // 既存 policy.yaml がある場合は .bak に退避（破壊防止）
      const { writeFile, rename, readFile } = await import("node:fs/promises");
      try {
        const existing = await readFile(ctx.policyPath, "utf-8");
        await writeFile(`${ctx.policyPath}.bak`, existing, { mode: 0o600 });
      } catch {
        // 初回（ファイル無し）の場合は退避不要
      }

      // MINIMAL_POLICY_YAML の defaults をベースに、選択ルールを足して書き出す
      const base = parseYaml(MINIMAL_POLICY_YAML) as { defaults: unknown };
      const body = stringifyYaml({ defaults: base.defaults, rules }, { lineWidth: 0 });
      const header = `# Vigili Policy — Mac アプリのウィザードで生成 (${new Date().toISOString()})\n# 手動で編集する場合は \`vigili-cli reload\` で反映してください。\n\n`;
      const tmp = `${ctx.policyPath}.${process.pid}.tmp`;
      await writeFile(tmp, header + body, { mode: 0o600 });
      await rename(tmp, ctx.policyPath);
      await reloadPolicy(ctx);
      ctx.log(`[vigili-daemon] wizard wrote ${rules.length} rules to ${ctx.policyPath}`);
      const resp: AdminResponse = {
        kind: "admin",
        action: "policy-write-from-catalog",
        ok: true,
        written: rules.length,
      };
      conn.send(resp);
      return;
    } catch (err) {
      const resp: AdminResponse = {
        kind: "admin",
        action: "policy-write-from-catalog",
        ok: false,
        error: (err as Error).message,
      };
      conn.send(resp);
      return;
    }
  }
  // resolve-by-session: PostToolUse hook 用
  // Claude Code がツールを実行した後に呼ばれ、対応する pending を allow で解決する。
  // tool_name が与えられた場合は「session_id かつ実行ツールと一致」する pending
  // だけを解決し、同一セッションの未承認 pending の巻き込み allow を防ぐ。
  if (req.action === "resolve-by-session") {
    const candidates = ctx.queue.list().filter((r) => {
      if (r.session_id !== req.session_id) return false;
      // tool_name 省略時は後方互換: session 全件。
      if (req.tool_name === undefined) return true;
      if (r.tool_name !== req.tool_name) return false;
      // tool_input が与えられていれば安定キーで照合 (表記揺れに強くするため
      // Bash は command、Edit/Write は file_path のみ比較。なければ tool_name 一致で許容)。
      if (req.tool_input === undefined) return true;
      return toolInputMatches(r.tool_name, r.tool_input, req.tool_input);
    });
    let resolved = 0;
    for (const item of candidates) {
      const ok = ctx.queue.resolve(item.id, "allow", "human:post-tool-use", "Claude Code approved");
      if (ok) resolved++;
    }
    const resp: AdminResponse = { kind: "admin", action: "resolve-by-session", ok: true, resolved };
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

/**
 * PostToolUse の tool_input と pending の tool_input が「同じ操作」かを判定する。
 * tool_input 全体の deep equal は表記揺れ (キー順・付随フィールド) に弱いため、
 * ツール種別ごとの安定キーだけを比較する。
 *   - Bash: command
 *   - Edit/Write/MultiEdit/NotebookEdit: file_path
 *   - それ以外: 安定キーが無いので tool_name 一致で許容 (true)
 */
function toolInputMatches(
  toolName: string,
  pending: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  const keyFor = (name: string): string | null => {
    if (name === "Bash") return "command";
    if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
      return "file_path";
    }
    return null;
  };
  const key = keyFor(toolName);
  if (key === null) return true; // 安定キー無し → tool_name 一致で許容
  const a = pending[key];
  const b = incoming[key];
  // どちらかが文字列として取れないなら、巻き込みを避けるため不一致扱い。
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a === b;
}

/**
 * L4 ホスト型セッション (`vigili run`) からの socket メッセージを捌く。
 * 同じ conn 上の双方向通信で、回答 (answer / permission-decision / plan-decision /
 * reply) を書き戻す。
 */
async function handleSessionMessage(
  parsed: unknown,
  conn: ConnContext,
  ctx: DaemonContext,
): Promise<void> {
  const result = SessionRunnerMessageSchema.safeParse(parsed);
  if (!result.success) {
    conn.send({
      type: "session-error",
      error: `invalid session message: ${result.error.issues.map((i) => i.message).join("; ")}`,
    } satisfies SessionDaemonMessage);
    return;
  }
  const msg = result.data;

  switch (msg.type) {
    case "session-start": {
      const session: HostedSession = {
        session_id: msg.session_id,
        tag: msg.tag,
        cwd: msg.cwd,
        status: "running",
        started_at: Date.now(),
      };
      ctx.sessions.register(session, conn);
      // runner conn が切れたらセッションを終了して client に伝える。
      conn.onClose(() => {
        const ended = ctx.sessions.endByConn(conn);
        if (ended) {
          ctx.broadcast({
            type: "session-ended",
            session_id: ended.session_id,
            reason: "runner disconnected",
          });
          ctx.log(`[vigili-daemon] session ended (disconnect): ${ended.session_id}`);
        }
      });
      ctx.broadcast({ type: "session-started", session });
      ctx.log(`[vigili-daemon] session started: ${session.session_id} (tag=${session.tag ?? "-"})`);
      return;
    }
    case "transcript-append": {
      ctx.broadcast({ type: "transcript-append", session_id: msg.session_id, line: msg.line });
      return;
    }
    case "question": {
      ctx.sessions.trackRequest(msg.request_id, msg.session_id, "question");
      ctx.sessions.setStatus(msg.session_id, "awaiting");
      ctx.broadcast({
        type: "question",
        session_id: msg.session_id,
        request_id: msg.request_id,
        questions: msg.questions,
      });
      return;
    }
    case "plan": {
      ctx.sessions.trackRequest(msg.request_id, msg.session_id, "plan");
      ctx.sessions.setStatus(msg.session_id, "awaiting");
      ctx.broadcast({
        type: "plan",
        session_id: msg.session_id,
        request_id: msg.request_id,
        plan: msg.plan,
      });
      return;
    }
    case "permission-request": {
      await handleSessionPermission(msg, conn, ctx);
      return;
    }
    case "session-end": {
      const ended = ctx.sessions.end(msg.session_id);
      if (ended) {
        ctx.broadcast({
          type: "session-ended",
          session_id: ended.session_id,
          ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
        });
        ctx.log(`[vigili-daemon] session ended: ${ended.session_id}`);
      }
      return;
    }
  }
}

/**
 * ホスト型セッションの permission を、既存の policy engine + queue を再利用して判定する。
 * これにより `vigili run` のツール承認も自動許可/自動拒否/スマホ承認の恩恵を受ける
 * (SPEC §8.6: permission は既存 pending/ApprovalRequest を流用)。
 */
async function handleSessionPermission(
  msg: Extract<SessionRunnerMessage, { type: "permission-request" }>,
  conn: ConnContext,
  ctx: DaemonContext,
): Promise<void> {
  const sess = ctx.sessions.get(msg.session_id);
  const cwd = msg.cwd ?? sess?.cwd ?? ".";
  const tag = sess?.tag ?? null;

  const id = randomUUID();
  ctx.store.insert({
    id,
    created_at: Date.now(),
    session_id: msg.session_id,
    session_tag: tag,
    tool_name: msg.tool_name,
    tool_input: msg.tool_input,
    cwd,
  });

  const toolReq: ToolRequest = {
    tool_name: msg.tool_name,
    tool_input: msg.tool_input,
    cwd,
    session_id: msg.session_id,
    ...(tag !== null ? { session_tag: tag } : {}),
  };
  const decision = decide(toolReq, ctx.policy, { sessionTags: ctx.sessionTags });

  if (decision.action !== "ask") {
    finalizeImmediate(id, decision, ctx);
    conn.send({
      type: "permission-decision",
      request_id: msg.request_id,
      decision: decision.action === "allow" ? "allow" : "deny",
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
    } satisfies SessionDaemonMessage);
    return;
  }

  const approvalRow = ctx.store.get(id);
  if (!approvalRow) {
    ctx.store.resolve({
      id,
      resolved_at: Date.now(),
      decision: "deny",
      decided_by: "internal:store-miss",
      reason: "session permission 処理中に DB から消えました",
    });
    conn.send({
      type: "permission-decision",
      request_id: msg.request_id,
      decision: "deny",
      reason: "internal store miss",
    } satisfies SessionDaemonMessage);
    return;
  }

  if (conn.isClosed()) {
    ctx.store.resolve({
      id,
      resolved_at: Date.now(),
      decision: "deny",
      decided_by: "cancelled:runner-pre-disconnected",
      reason: "runner が enroll 前に既に切断していた",
    });
    return;
  }

  // runner が応答待ち中に切断したら queue から消す。
  conn.onClose(() => {
    if (ctx.queue.has(id)) {
      ctx.queue.resolve(id, "deny", "cancelled:runner-disconnected", "runner が応答待ち中に切断");
    }
  });

  ctx.sessions.setStatus(msg.session_id, "awaiting");
  void ctx.notifier.notify({
    request: approvalRow,
    level: decision.notify ?? "normal",
    ruleSource: decision.source,
  });

  const timeoutMs = ctx.policy.defaults.timeout_seconds * 1000;
  const resolution = await ctx.queue.enroll(approvalRow, timeoutMs);
  persistResolution(id, resolution, decision, ctx);
  ctx.sessions.setStatus(msg.session_id, "running");

  if (!conn.isClosed()) {
    // runner セッションには Claude Code のネイティブ確認フローが存在しないため、
    // fallback (ask タイムアウト) は従来どおり deny として返す。
    const runnerDecision = resolution.decision === "fallback" ? "deny" : resolution.decision;
    conn.send({
      type: "permission-decision",
      request_id: msg.request_id,
      decision: runnerDecision,
      ...(resolution.reason !== null ? { reason: resolution.reason } : {}),
    } satisfies SessionDaemonMessage);
  }
}

/**
 * client (iOS/Mac/PWA) からの session 系メッセージを、対応する runner の conn に
 * 書き戻す。answer-question / decide-plan は request_id、session-reply は session_id で引く。
 */
function handleSessionClientMessage(msg: WsClientMessage, ctx: DaemonContext): void {
  if (msg.type === "answer-question") {
    const rec = ctx.sessions.takeRequest(msg.request_id);
    if (!rec) {
      ctx.log(`[vigili-daemon] answer-question: request ${msg.request_id} 不明 / 既に回答済み`);
      return;
    }
    ctx.sessions.sendToSession(rec.sessionId, {
      type: "answer",
      request_id: msg.request_id,
      answers: msg.answers,
    });
    ctx.sessions.setStatus(rec.sessionId, "running");
    return;
  }
  if (msg.type === "decide-plan") {
    const rec = ctx.sessions.takeRequest(msg.request_id);
    if (!rec) {
      ctx.log(`[vigili-daemon] decide-plan: request ${msg.request_id} 不明 / 既に決着済み`);
      return;
    }
    ctx.sessions.sendToSession(rec.sessionId, {
      type: "plan-decision",
      request_id: msg.request_id,
      decision: msg.decision,
      ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
    });
    ctx.sessions.setStatus(rec.sessionId, "running");
    return;
  }
  if (msg.type === "session-reply") {
    const ok = ctx.sessions.sendToSession(msg.session_id, { type: "reply", body: msg.body });
    if (!ok) ctx.log(`[vigili-daemon] session-reply: session ${msg.session_id} 不明 / 切断済み`);
    return;
  }
  // decide / send-message はこの経路に来ない (呼び出し側で振り分け済み)。
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

  // gate 由来セッションを Sessions 画面へ合成登録 (SPEC §8.5.1)。
  // 初出の session_id なら session-started を broadcast し、以降は lastSeen を更新する。
  if (req.session_id !== "") {
    const observed = ctx.sessions.observe({
      session_id: req.session_id,
      tag: inferRepoTag(req, ctx.sessionTags),
      cwd: req.cwd,
      now,
    });
    if (observed.created) {
      ctx.broadcast({ type: "session-started", session: observed.session });
      ctx.log(
        `[vigili-daemon] observed session started: ${req.session_id} (tag=${observed.session.tag ?? "-"})`,
      );
    }
  }

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

  // native-first モード (SPEC §2.6): ask を Vigili に出さず即ネイティブ確認へ委ねる。
  // pending broadcast はせず、履歴には fallback として記録する。
  // fallback は無出力 exit 0 なので gate は Claude にメッセージを渡せない —
  // drain する前にこの分岐を通ること (メッセージは queue に残り、次の allow/ask で届く)。
  if (result.action === "ask" && ctx.askMode() === "native-first") {
    ctx.store.resolve({
      id,
      resolved_at: Date.now(),
      decision: "fallback",
      decided_by: `ask-mode:native-first (policy:${result.source})`,
      reason: "Claude アプリ優先モードのためネイティブ確認に委譲",
    });
    conn.send({ decision: "fallback", reason: "ask-mode: native-first" } satisfies Decision);
    return;
  }

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

  // Race condition 対策: onClose は socket の 'close' イベントに乗る一度きりのコールバック。
  // gate が "ask" レスポンスを受け取った直後に切断した場合、'close' イベントは既に
  // 発火済みで closeListeners は空になっているため上記 onClose は呼ばれない。
  // → この時点で既に closed なら即座に deny して store に記録し return する。
  if (conn.isClosed()) {
    ctx.store.resolve({
      id,
      resolved_at: Date.now(),
      decision: "deny",
      decided_by: "cancelled:gate-pre-disconnected",
      reason: "gate が enroll 前に既に切断していた",
    });
    return;
  }

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
