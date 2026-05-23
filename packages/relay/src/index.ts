/**
 * Sentinel Relay のエントリポイント (Phase 14-A skeleton)。
 *
 * 役割は README 参照。現状は最小の Fastify + WSS 雛形のみ。
 *
 * 続く実装予定:
 *   - SQLite/Postgres でのアカウント / pairing 永続化
 *   - 認証 (session token、agent key、user token)
 *   - WSS fan-out (pairing-id ごと)
 *   - APNs Push (node-apn)
 *   - App Store IAP 検証
 */

import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";

export interface RelayOptions {
  port: number;
  host?: string;
  /** ログ関数。デフォルト console.error。 */
  log?: (msg: string) => void;
}

export async function startRelay(options: RelayOptions): Promise<{ close: () => Promise<void> }> {
  const log = options.log ?? ((m) => console.error(m));
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  // 健康確認用 (Caddy / uptime monitoring で叩く)
  app.get("/healthz", async () => ({ ok: true }));

  // ペアリング ID ごとの fan-out 状態を保持する in-memory store。
  // 実装は Phase 14-A の続きで詰める。
  const pairings = new Map<string, Pairing>();

  app.get("/v1/agents/:pid", { websocket: true }, (socket, req) => {
    const pid = (req.params as { pid: string }).pid;
    // TODO: agent_key 検証
    log(`[relay] agent connected: ${pid}`);
    let pairing = pairings.get(pid);
    if (!pairing) {
      pairing = { agent: null, clients: new Set() };
      pairings.set(pid, pairing);
    }
    pairing.agent = socket as unknown as RelayWS;
    socket.on("message", (raw: Buffer) => {
      // agent → all clients に fan-out
      for (const c of pairing!.clients) {
        try {
          c.send(raw.toString("utf-8"));
        } catch {
          /* ignore */
        }
      }
    });
    socket.on("close", () => {
      if (pairing!.agent === (socket as unknown as RelayWS)) pairing!.agent = null;
      // 全 clients に agent-status: offline を流す (今は placeholder)
      const offlineMsg = JSON.stringify({ type: "agent-status", online: false });
      for (const c of pairing!.clients) {
        try {
          c.send(offlineMsg);
        } catch {
          /* ignore */
        }
      }
    });
  });

  app.get("/v1/clients/:pid", { websocket: true }, (socket, req) => {
    const pid = (req.params as { pid: string }).pid;
    // TODO: user_token 検証
    log(`[relay] client connected: ${pid}`);
    let pairing = pairings.get(pid);
    if (!pairing) {
      pairing = { agent: null, clients: new Set() };
      pairings.set(pid, pairing);
    }
    const ws = socket as unknown as RelayWS;
    pairing.clients.add(ws);
    socket.on("message", (raw: Buffer) => {
      // client → agent に転送 (typically: decide)
      try {
        pairing!.agent?.send(raw.toString("utf-8"));
      } catch {
        /* ignore */
      }
    });
    socket.on("close", () => {
      pairing!.clients.delete(ws);
    });
  });

  // ペアリング作成 API (Phase 14-A 続きで実装)
  app.post("/v1/pairings", async (_req, reply) => {
    return reply.code(501).send({ error: "not implemented yet" });
  });

  const host = options.host ?? "0.0.0.0";
  await app.listen({ port: options.port, host });
  log(`[relay] listening on http://${host}:${options.port}`);

  return {
    close: async () => {
      await app.close();
    },
  };
}

interface RelayWS {
  send(data: string): void;
}

interface Pairing {
  agent: RelayWS | null;
  clients: Set<RelayWS>;
}
