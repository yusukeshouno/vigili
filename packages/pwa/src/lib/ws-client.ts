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
 * シンプルな WebSocket クライアント。
 * - 接続失敗 / 切断時に exponential backoff (max 10s) で再接続する。
 * - 状態変更は onState で通知する。
 */
export function createWsClient(url: string, handlers: WsClientHandlers): WsClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: number | null = null;

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
    if (closed) return;
    const delay = Math.min(10_000, 500 * 2 ** retry);
    retry++;
    reconnectTimer = window.setTimeout(connect, delay);
  };

  connect();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
    },
  };
}
