"use client";

import type { WsClientMessage, WsServerMessage } from "@vigili/shared";

export type ConnectionState = "connecting" | "open" | "closed" | "error";

export interface WsClientHandlers {
  onMessage: (msg: WsServerMessage) => void;
  onState: (state: ConnectionState, detail?: string) => void;
}

export interface WsClient {
  send(msg: WsClientMessage): void;
  close(): void;
}

/**
 * WebSocket クライアント。
 * - 接続失敗 / 切断時に exponential backoff (max 5s) で再接続。
 * - タブ復帰 (visibilitychange) / ネット復帰 (online) で backoff を待たず即再接続し、
 *   「同期が切れたまま放置」を防ぐ。
 * - 状態変更は onState で通知。
 *
 * half-open (TCP は生きているが相手が消えている) の検知は server 側 ping/timeout に任せる
 * (relay は agent/client に周期 ping → 死んでいれば close が飛ぶ)。ブラウザ WS API は
 * ping を撃てず、アプリメッセージの無通信は idle と区別できないため、こちら発の
 * staleness 強制再接続は入れない (idle での誤再接続を避ける)。
 */
export function createWsClient(url: string, handlers: WsClientHandlers): WsClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: number | null = null;

  const clearTimer = (): void => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = (): void => {
    if (closed) return;
    handlers.onState("connecting");
    try {
      ws = new WebSocket(url);
    } catch (err) {
      handlers.onState("error", (err as Error).message);
      scheduleReconnect();
      return;
    }
    ws.addEventListener("open", () => {
      retry = 0;
      handlers.onState("open");
    });
    ws.addEventListener("message", (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      handlers.onMessage(parsed as WsServerMessage);
    });
    ws.addEventListener("error", () => {
      handlers.onState("error", "WebSocket error");
    });
    ws.addEventListener("close", (ev) => {
      const detail = `code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""}`;
      handlers.onState("closed", detail);
      if (ev.code === 4401 || ev.code === 1008) {
        // 認証エラー: 再接続しても直らないので止める
        closed = true;
        return;
      }
      scheduleReconnect();
    });
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== null) return;
    const delay = Math.min(5_000, 500 * 2 ** retry);
    retry++;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  /** backoff を待たず即再接続する。タブ/ネット復帰イベントで呼ぶ。 */
  const reconnectNow = (): void => {
    if (closed) return;
    // 既に生きている / 接続試行中なら触らない (churn 防止)
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimer();
    retry = 0;
    connect();
  };

  const onVisible = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") reconnectNow();
  };
  const onOnline = (): void => reconnectNow();

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
  }

  connect();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      clearTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
      ws?.close();
    },
  };
}
