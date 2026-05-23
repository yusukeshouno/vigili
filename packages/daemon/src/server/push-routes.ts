import { PushSubscriptionJsonSchema } from "@sentinel/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SubscriptionStore, VapidKeys } from "../notify/web-push.js";

/**
 * Web Push 用の HTTP エンドポイントを Fastify app に登録する。
 *
 * - GET    /push/vapid-public-key  (公開 / 認証不要、subscribe 前に PWA が叩く)
 * - POST   /push/subscriptions     (要 Bearer token、subscribe 完了通知)
 * - DELETE /push/subscriptions     (要 Bearer token、unsubscribe)
 *
 * Bearer は WS と同じ token 文字列を流用する (paths.token)。
 */

export interface PushRoutesOptions {
  vapid: VapidKeys;
  store: SubscriptionStore;
  token: string;
  log?: (msg: string) => void;
}

const RemoveBodySchema = z.object({ endpoint: z.string().url() });

export async function registerPushRoutes(
  app: FastifyInstance,
  opts: PushRoutesOptions,
): Promise<void> {
  const log = opts.log ?? ((m) => console.error(m));

  // CORS: PWA が別 origin (例: Vercel) から叩く可能性がある。
  // 認証は Bearer なので CORS は緩めて良い。OPTIONS の preflight を許す。
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/push/")) {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    }
    return payload;
  });

  app.options("/push/*", async (_req, reply) => {
    reply.code(204).send();
  });

  // 公開鍵 (base64url の P-256 公開鍵)。
  // PWA はこれを Uint8Array に decode して applicationServerKey に渡す。
  app.get("/push/vapid-public-key", async (_req, reply) => {
    reply.send({ publicKey: opts.vapid.publicKey });
  });

  app.post("/push/subscriptions", async (req, reply) => {
    if (!authorized(req.headers.authorization, opts.token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = PushSubscriptionJsonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid PushSubscription",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const ua =
      typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
    opts.store.add({
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
      created_at: Date.now(),
      ...(ua ? { user_agent: ua } : {}),
    });
    log(
      `[sentinel-push] subscription 登録: ${truncEnd(parsed.data.endpoint)} (total ${opts.store.size()})`,
    );
    return reply.code(201).send({ ok: true, total: opts.store.size() });
  });

  app.delete("/push/subscriptions", async (req, reply) => {
    if (!authorized(req.headers.authorization, opts.token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = RemoveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body" });
    }
    const removed = opts.store.remove(parsed.data.endpoint);
    log(
      `[sentinel-push] subscription 削除 ${removed ? "ok" : "miss"}: ${truncEnd(parsed.data.endpoint)}`,
    );
    return reply.send({ ok: true, removed });
  });
}

function authorized(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) return false;
  const m = /^Bearer\s+(\S+)$/iu.exec(authHeader);
  if (!m?.[1]) return false;
  return constantTimeEquals(m[1], token);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function truncEnd(s: string): string {
  return s.length <= 60 ? s : `…${s.slice(s.length - 60)}`;
}
