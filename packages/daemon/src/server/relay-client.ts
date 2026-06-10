/**
 * Vigili Cloud Relay (Phase 14-B) への outbound WebSocket クライアント。
 *
 * Mac daemon が `relay.vigili.io` 等に WSS を張り、以下を伝送する:
 *
 *   daemon → relay  : 既存 `WsServerMessage` (snapshot / pending / resolved /
 *                     message-added / message-delivered)
 *   relay → daemon  : 既存 `WsClientMessage` (decide / send-message)
 *
 * relay 側は `/v1/agents/:pid` で agent_key を query token として受ける。
 * relay は中身を解釈せず pairing-id ごとに fan-out するだけなので、
 * 既存の LAN WS と「同じ言語」を喋れば iOS app からは透過に見える。
 *
 * 再接続: 指数バックオフ + max cap (デフォルト 30s)。
 */

import { type WsClientMessage, WsClientMessageSchema, type WsServerMessage } from "@vigili/shared";
import WebSocket, { type RawData } from "ws";

export interface RelayClientOptions {
  /** "wss://relay.vigili.io" など。末尾スラなし。 */
  url: string;
  /** pairing-id (UUID)。 */
  pairingId: string;
  /** Agent key (発行時の平文)。 */
  agentKey: string;
  /** 再接続の最大 backoff 秒。 */
  reconnectMaxSeconds: number;
  /** client (PWA/iOS) からの decide / send-message を受けたときに呼ばれる。 */
  onClientMessage: (msg: WsClientMessage) => void;
  /** WS open のたびに呼ばれる。daemon は接続直後に snapshot を送り直すなど。
   *  再接続後も毎回呼ばれるので、最新の queue 状態をその都度 flush できる。 */
  onOpen?: () => void;
  /** relay から "refresh-snapshot" が来たとき (account stream 新 client 接続時) に呼ばれる。
   *  daemon は snapshot + stats を再ブロードキャストする。 */
  onRefreshSnapshot?: () => void;
  log: (msg: string) => void;
}

export interface RelayClient {
  /** WS を貼り、再接続を開始する。 */
  start(): void;
  /** 切断 + 以後の再接続を止める。 */
  stop(): Promise<void>;
  /** PWA に対する WS と同じ「broadcast」関数。relay 経由で client 全員に届く。 */
  send(msg: WsServerMessage): void;
  /** 現在 relay と接続できているか (テスト / 観測用)。 */
  isConnected(): boolean;
  /**
   * 接続先 (url/pairing/agent_key) を差し替え、即座に貼り直す。
   * プロセス再起動なしで Mac アプリのサインインから relay へ繋ぐために使う。
   * auth 失敗で停止していた場合も復活させる。
   */
  reconfigure(opts: {
    url: string;
    pairingId: string;
    agentKey: string;
    reconnectMaxSeconds?: number | undefined;
  }): void;
}

/** keepalive: この間隔で ping を撃ち、次の interval までに pong が来なければ half-open とみなす。
 *  短いほど断線・sleep 復帰後の再同期が速い (検知 ≒ 1 interval + 次 interval)。 */
const PING_INTERVAL_MS = 10_000;

export function createRelayClient(options: RelayClientOptions): RelayClient {
  const { onClientMessage, onOpen, onRefreshSnapshot, log } = options;
  // 接続パラメータは reconfigure() で差し替えられるよう可変にする。
  let url = options.url;
  let pairingId = options.pairingId;
  let agentKey = options.agentKey;
  let reconnectMaxSeconds = options.reconnectMaxSeconds;
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  /** WS 接続できていない間、相手に届かない send を捨てるか溜めるか — まず捨てる方針。 */
  let connected = false;
  /** keepalive 用の周期 ping タイマと「前回 ping への pong 待ち」フラグ。 */
  let pingTimer: NodeJS.Timeout | null = null;
  let awaitingPong = false;

  function stopPing(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    awaitingPong = false;
  }

  /**
   * 周期 ping で half-open 接続を検知する。TCP は片側が消えても無音のままになり得る
   * (laptop sleep / NAT mapping 失効 / proxy idle kill)。pong が前回 interval までに
   * 返らなければ terminate し、'close' → scheduleReconnect に乗せて貼り直す。
   */
  function startPing(): void {
    stopPing();
    awaitingPong = false;
    pingTimer = setInterval(() => {
      const sock = ws;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      if (awaitingPong) {
        log("[vigili-relay] pong 未達 — half-open とみなし terminate");
        try {
          sock.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      awaitingPong = true;
      try {
        sock.ping();
      } catch (err) {
        log(`[vigili-relay] ping failed: ${(err as Error).message}`);
      }
    }, PING_INTERVAL_MS);
  }

  function connect(): void {
    if (closed) return;
    // endpoint は接続のたびに最新パラメータから組む (reconfigure 対応)。
    const endpoint = `${url.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(
      pairingId,
    )}?token=${encodeURIComponent(agentKey)}`;
    log(`[vigili-relay] connecting → ${url.replace(/\/$/, "")}/v1/agents/${pairingId}`);
    try {
      ws = new WebSocket(endpoint, { handshakeTimeout: 10_000 });
    } catch (err) {
      log(`[vigili-relay] new WebSocket() throw: ${(err as Error).message}`);
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      connected = true;
      retry = 0;
      log("[vigili-relay] connected");
      startPing();
      // 呼び出し側が snapshot 等を flush できるよう通知
      try {
        onOpen?.();
      } catch (err) {
        log(`[vigili-relay] onOpen handler threw: ${(err as Error).message}`);
      }
    });

    // 相手 (hub) が pong を返したら接続は生きている。次の interval の terminate を防ぐ。
    ws.on("pong", () => {
      awaitingPong = false;
    });

    ws.on("message", (raw: RawData) => {
      // relay は agent-status を独自に inject する。それは無視し、
      // 既存 WsClientMessageSchema に乗るもの (decide / send-message) だけ
      // daemon のハンドラに流す。
      const text = typeof raw === "string" ? raw : raw.toString("utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { type?: unknown }).type === "agent-status"
      ) {
        // relay 内部メッセージ。今は無視。将来 status UI に出す。
        return;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { type?: unknown }).type === "refresh-snapshot"
      ) {
        // account stream に新 client が接続 → snapshot + stats を再送する。
        onRefreshSnapshot?.();
        return;
      }
      const r = WsClientMessageSchema.safeParse(parsed);
      if (!r.success) {
        log(`[vigili-relay] 不正な inbound: ${r.error.issues.map((i) => i.message).join(", ")}`);
        return;
      }
      onClientMessage(r.data);
    });

    ws.on("close", (code, reason) => {
      connected = false;
      stopPing();
      const detail = `code=${code}${reason.length > 0 ? ` reason=${reason.toString("utf-8")}` : ""}`;
      log(`[vigili-relay] closed (${detail})`);
      // 401 (auth) / 404 (no pairing) は再接続しても直らない。短期だけ retry してから諦める。
      if ((code === 4401 || code === 4404 || code === 1008) && retry > 3) {
        log("[vigili-relay] 認証/不在エラー継続のため再接続停止");
        closed = true;
        return;
      }
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      log(`[vigili-relay] error: ${err.message}`);
      // 'close' が後続するので scheduleReconnect はそこで行う
    });
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (reconnectTimer) return;
    const delay = Math.min(reconnectMaxSeconds * 1000, 500 * 2 ** retry);
    retry += 1;
    log(`[vigili-relay] reconnect in ${Math.round(delay / 100) / 10}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  return {
    start() {
      if (closed) return;
      connect();
    },
    async stop() {
      closed = true;
      stopPing();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close(1000, "shutdown");
      } catch {
        /* ignore */
      }
    },
    send(msg: WsServerMessage) {
      if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        log(`[vigili-relay] send failed: ${(err as Error).message}`);
      }
    },
    isConnected() {
      return connected;
    },
    reconfigure(opts) {
      url = opts.url;
      pairingId = opts.pairingId;
      agentKey = opts.agentKey;
      if (opts.reconnectMaxSeconds !== undefined) reconnectMaxSeconds = opts.reconnectMaxSeconds;
      // auth 失敗等で停止していたら復活させ、backoff もリセットして即時に貼り直す。
      closed = false;
      retry = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopPing();
      connected = false;
      if (ws) {
        // 旧 socket の listener を外し、close からの競合 reconnect を防いでから捨てる。
        ws.removeAllListeners();
        try {
          ws.close(1000, "reconfigure");
        } catch {
          /* ignore */
        }
        ws = null;
      }
      log(`[vigili-relay] reconfigure → ${url.replace(/\/$/, "")}/v1/agents/${pairingId}`);
      connect();
    },
  };
}
