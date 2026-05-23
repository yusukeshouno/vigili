import fastifyWebsocket from "@fastify/websocket";
import {
  type Message,
  type WsClientMessage,
  WsClientMessageSchema,
  type WsServerMessage,
} from "@vigili/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { SubscriptionStore, VapidKeys } from "../notify/web-push.js";
import type { PendingQueue } from "../queue.js";
import { registerPushRoutes } from "./push-routes.js";

export interface WsServerOptions {
  port: number;
  host?: string;
  token: string;
  queue: PendingQueue;
  /** WS client が decide で promote を含めてきたときに呼ばれる。Phase 7 で実装。 */
  onPromote?: (req: WsClientMessage) => void;
  /**
   * PWA が新しいメッセージを送ってきたときの hook。daemon 側で messages テーブルに
   * insert して、永続化された Message を返すと WS が全クライアントに broadcast する。
   * 何も返さない (undefined) と broadcast されない (rate limit / 不正入力時用)。
   */
  onSendMessage?: (session_id: string, body: string) => Message | undefined;
  /** snapshot に同梱する recent messages を取得するコールバック (省略時は空配列)。 */
  recentMessages?: () => Message[];
  log?: (msg: string) => void;
  /** Web Push のエンドポイントも同じ Fastify インスタンスに乗せる場合に渡す。 */
  push?: { vapid: VapidKeys; store: SubscriptionStore };
}

export interface RunningWsServer {
  url: string;
  close(): Promise<void>;
  /** 外部 (daemon の handleToolRequest 等) から message-added / message-delivered を流す。 */
  broadcast(msg: WsServerMessage): void;
}

/**
 * Fastify + @fastify/websocket。
 *
 * 認証: `?token=<bearer>` または `Authorization: Bearer <token>` ヘッダ。
 * 失敗時は接続を直ちに閉じる (HTTP では 401 を返す方が好ましいが、Tailscale Funnel 経由で
 * クライアントの挙動を観察したところ WS 拒否は connection close で十分機能する)。
 */
export async function startWsServer(options: WsServerOptions): Promise<RunningWsServer> {
  const log = options.log ?? ((m) => console.error(m));
  const app: FastifyInstance = Fastify({ logger: false });

  await app.register(fastifyWebsocket);

  // Web Push の HTTP エンドポイントを WS と同じポートに同居させる。
  // PWA は同一 origin の wss と https をしゃべる前提なので CORS と相性が良い。
  if (options.push) {
    await registerPushRoutes(app, {
      vapid: options.push.vapid,
      store: options.push.store,
      token: options.token,
      log,
    });
  }

  // 内部で管理するソケット集合 (broadcast 用)。
  const sockets = new Set<{
    send: (msg: WsServerMessage) => void;
    close: () => void;
  }>();

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const token = extractToken(req.url ?? "", req.headers.authorization);
        if (!constantTimeEquals(token ?? "", options.token)) {
          log("[vigili-ws] 認証失敗 → 401");
          return reply.code(401).send({ error: "unauthorized" });
        }
      },
    },
    (socket, _req) => {
      const wrap = {
        send(msg: WsServerMessage): void {
          try {
            socket.send(JSON.stringify(msg));
          } catch {
            // 書き込み失敗時は破棄
          }
        },
        close(): void {
          try {
            socket.close();
          } catch {
            // ignore
          }
        },
      };
      sockets.add(wrap);

      // snapshot を送信
      const recent = options.recentMessages?.() ?? [];
      wrap.send(
        recent.length > 0
          ? { type: "snapshot", pending: options.queue.list(), messages: recent }
          : { type: "snapshot", pending: options.queue.list() },
      );

      socket.on("message", (raw: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf-8"));
        } catch {
          return;
        }
        const result = WsClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          log(
            `[vigili-ws] 不正な client message: ${result.error.issues
              .map((i) => i.message)
              .join(", ")}`,
          );
          return;
        }
        handleClientMessage(result.data, options, broadcast);
      });

      socket.on("close", () => {
        sockets.delete(wrap);
      });
    },
  );

  // queue → broadcast bridges
  const broadcast = (msg: WsServerMessage): void => {
    for (const s of sockets) s.send(msg);
  };
  const offPending = options.queue.onPending((req) => {
    broadcast({ type: "pending", request: req });
  });
  const offResolved = options.queue.onResolved((id, decision) => {
    broadcast({ type: "resolved", id, decision });
  });

  const host = options.host ?? "127.0.0.1";
  await app.listen({ port: options.port, host });
  log(`[vigili-ws] listening on ws://${host}:${options.port}/ws`);

  // Bonjour で同 LAN にブロードキャスト (iPhone 等が NWBrowser で見つける)。
  // 公開するのは「Sentinel が居る」「ポート」「path /ws」「token 必要」だけ。
  // token そのものは流さない (公開ネットワークに token を漏らさない)。
  let bonjour: { unpublish: () => void } | null = null;
  if (host === "0.0.0.0" || host === "::") {
    try {
      // bonjour-service は CJS。Node ESM の dynamic import だと
      // `mod.Bonjour` または `mod.default.Bonjour` のどちらかに収まる。
      const mod = (await import("bonjour-service")) as unknown as {
        Bonjour?: new () => { publish: (opts: object) => { stop?: () => void }; destroy?: () => void };
        default?: {
          Bonjour?: new () => { publish: (opts: object) => { stop?: () => void }; destroy?: () => void };
        };
      };
      const BonjourCtor = mod.Bonjour ?? mod.default?.Bonjour;
      if (!BonjourCtor) {
        throw new Error("bonjour-service の export 形状が想定外");
      }
      const bj = new BonjourCtor();
      const service = bj.publish({
        name: "Sentinel",
        type: "sentinel",
        port: options.port,
        // TXT は短く: WS path
        txt: { path: "/ws" },
      });
      bonjour = {
        unpublish: () => {
          try {
            service.stop?.();
            bj.destroy?.();
          } catch {
            /* ignore */
          }
        },
      };
      log(`[vigili-ws] Bonjour: _sentinel._tcp on port ${options.port}`);
    } catch (err) {
      log(`[vigili-ws] Bonjour publish failed: ${(err as Error).message}`);
    }
  }

  return {
    url: `ws://${host}:${options.port}/ws`,
    close: async () => {
      bonjour?.unpublish();
      offPending();
      offResolved();
      for (const s of sockets) s.close();
      sockets.clear();
      await app.close();
    },
    broadcast,
  };
}

function handleClientMessage(
  msg: WsClientMessage,
  options: WsServerOptions,
  broadcast: (msg: WsServerMessage) => void,
): void {
  if (msg.type === "decide") {
    if (msg.promote && options.onPromote) {
      try {
        options.onPromote(msg);
      } catch (err) {
        (options.log ?? console.error)(
          `[vigili-ws] promote handler error: ${(err as Error).message}`,
        );
      }
    }
    const ok = options.queue.resolve(msg.id, msg.decision, "human:ws", null);
    if (!ok) {
      (options.log ?? console.error)(`[vigili-ws] decide: id ${msg.id} は既に決着済み / 未知`);
    }
    return;
  }
  if (msg.type === "send-message") {
    if (!options.onSendMessage) return;
    try {
      const stored = options.onSendMessage(msg.session_id, msg.body);
      if (stored) broadcast({ type: "message-added", message: stored });
    } catch (err) {
      (options.log ?? console.error)(
        `[vigili-ws] send-message handler error: ${(err as Error).message}`,
      );
    }
    return;
  }
}

function extractToken(url: string, authHeader: string | undefined): string | null {
  if (authHeader) {
    const m = /^Bearer\s+(\S+)$/iu.exec(authHeader);
    if (m?.[1]) return m[1];
  }
  // URL から token クエリを取り出す。/ws?token=... の形を想定。
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return null;
  const params = new URLSearchParams(url.slice(qIdx + 1));
  return params.get("token");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
