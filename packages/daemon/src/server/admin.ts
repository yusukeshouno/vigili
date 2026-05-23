import { ApprovalRequestSchema, FinalDecisionSchema } from "@sentinel/shared";
import { z } from "zod";

/**
 * Unix socket 上で daemon と sentinel-cli / Sentinel.app が交わす管理コマンド。
 * gate からは送らない。WebSocket とは別経路 (Bearer 認証なし、socket パーミッション 0600 で守る)。
 *
 * 弁別フィールド: kind === "admin"。これが無いメッセージは ToolRequest として扱う。
 */

export const AdminRequestSchema = z.discriminatedUnion("action", [
  z.object({
    kind: z.literal("admin"),
    action: z.literal("pending"),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("resolve"),
    id: z.string().uuid(),
    decision: FinalDecisionSchema,
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("reload"),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("stats"),
    /** UNIX ms。省略時は当日 00:00 (ローカル時刻ベース) */
    from_ms: z.number().int().nonnegative().optional(),
    /** UNIX ms。省略時は Date.now() + 60s (未来要素を含めず、丸めの取りこぼし防止に余裕) */
    to_ms: z.number().int().nonnegative().optional(),
  }),
]);

export type AdminRequest = z.infer<typeof AdminRequestSchema>;

/**
 * stats レスポンスは `StatsBuckets` の構造をそのまま使う。
 * Swift / TypeScript で同形を扱えるよう、zod スキーマで明示する。
 */
const StatsBucketsZ = z.object({
  total: z.number().int(),
  by_decision: z.object({
    allow: z.number().int(),
    deny: z.number().int(),
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

export const AdminResponseSchema = z.discriminatedUnion("action", [
  z.object({
    kind: z.literal("admin"),
    action: z.literal("pending"),
    ok: z.literal(true),
    pending: z.array(ApprovalRequestSchema),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("resolve"),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("reload"),
    ok: z.boolean(),
    rules: z.number().int().optional(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: z.literal("stats"),
    ok: z.literal(true),
    stats: StatsBucketsZ,
  }),
]);

export type AdminResponse = z.infer<typeof AdminResponseSchema>;
