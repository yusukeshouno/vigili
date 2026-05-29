import { z } from "zod";
import { ApprovalRequestSchema } from "./approval-request.js";
import { FinalDecisionSchema } from "./decision.js";
import { MessageSchema } from "./message.js";

/**
 * PWA がルール昇格 (Allow & promote to rule) を送るときの提案。
 * 受け取った daemon は policy.yaml に追記し reload する。
 */
export const PromoteRuleSchema = z.object({
  rule_name: z.string().min(1),
  match: z.object({
    tool: z.union([z.string(), z.array(z.string())]).optional(),
    command_matches: z.string().optional(),
    path_matches: z.string().optional(),
    url_matches: z.string().optional(),
    repo_in: z.array(z.string()).optional(),
  }),
});

export type PromoteRule = z.infer<typeof PromoteRuleSchema>;

/**
 * 観測可能性サマリー (daemon の `computeStats` / db/stats.ts と同形)。
 *
 * admin プロトコル (Unix socket) だけでなく WS でも配れるよう、ここ shared に
 * 正準スキーマを置く。iOS は admin socket に届かないので、WS の `stats` メッセージ
 * 経由で「今日の自動承認件数」等を受け取る (CLAUDE.md「観測可能性を最優先」)。
 */
export const StatsBucketsSchema = z.object({
  total: z.number().int(),
  by_decision: z.object({
    allow: z.number().int(),
    deny: z.number().int(),
    cancelled: z.number().int(),
    pending: z.number().int(),
  }),
  by_source: z.record(z.number().int()),
  by_tool: z.record(z.number().int()),
  by_tag: z.record(z.number().int()),
  human_response_ms: z.object({
    count: z.number().int(),
    mean: z.number().nullable(),
    p50: z.number().nullable(),
    p95: z.number().nullable(),
    max: z.number().nullable(),
  }),
  range: z.object({
    from: z.number().int(),
    to: z.number().int(),
  }),
});

export type StatsBuckets = z.infer<typeof StatsBucketsSchema>;

/** daemon → PWA */
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    pending: z.array(ApprovalRequestSchema),
    /** 接続時点で未配送 / 直近配送済みのメッセージ (composer の history 用)。 */
    messages: z.array(MessageSchema).optional(),
  }),
  z.object({
    type: z.literal("pending"),
    request: ApprovalRequestSchema,
  }),
  z.object({
    type: z.literal("resolved"),
    id: z.string().uuid(),
    decision: FinalDecisionSchema,
  }),
  // --- messages ---
  z.object({
    /** 新しいメッセージが queue された (送信者を含む全 WS クライアントに broadcast)。 */
    type: z.literal("message-added"),
    message: MessageSchema,
  }),
  z.object({
    /** queued されていたメッセージが gate で drain されて Claude に届いた。 */
    type: z.literal("message-delivered"),
    id: z.string().uuid(),
    delivered_at: z.number().int().nonnegative(),
  }),
  z.object({
    /**
     * 観測可能性サマリー (今日の自動承認/承認/ブロック件数等)。
     * 接続直後 (snapshot の直後) と、決着 (resolved) / sweep のたびに push される。
     * iOS の待機画面サマリーカードがこれを表示する。
     */
    type: z.literal("stats"),
    stats: StatsBucketsSchema,
  }),
]);

export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

/** PWA → daemon */
export const WsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("decide"),
    id: z.string().uuid(),
    decision: FinalDecisionSchema,
    promote: PromoteRuleSchema.nullable().optional(),
  }),
  z.object({
    /** session 宛に新しいメッセージを enqueue する。 */
    type: z.literal("send-message"),
    session_id: z.string().min(1),
    body: z.string().min(1).max(2000),
  }),
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
