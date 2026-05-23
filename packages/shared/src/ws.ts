import { z } from "zod";
import { ApprovalRequestSchema } from "./approval-request.js";
import { FinalDecisionSchema } from "./decision.js";

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

/** daemon → PWA */
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    pending: z.array(ApprovalRequestSchema),
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
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
