import { z } from "zod";
import { FinalDecisionSchema } from "./decision.js";

/**
 * approval_requests テーブルの 1 行。
 * 自動許可 / 自動拒否されたものも含めて、全リクエストがここに残る（監査用）。
 *
 * SQLite では JSON / nullable は文字列・NULL として保存するため、
 * 永続化境界 (daemon の DB アクセス層) でこの形に整形する。
 */
export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  created_at: z.number().int(),
  resolved_at: z.number().int().nullable(),
  session_id: z.string(),
  session_tag: z.string().nullable(),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()),
  cwd: z.string(),
  decision: FinalDecisionSchema.nullable(),
  /** 'policy:<rule_name>' | 'human:<source>' | 'timeout' | 'invariant:<name>' */
  decided_by: z.string().nullable(),
  reason: z.string().nullable(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
