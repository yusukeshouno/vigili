import { z } from "zod";
import { MessageSchema } from "./message.js";

/**
 * daemon が gate に返す即時判定。
 * - allow / deny: そのまま gate が exit code に変換
 * - ask: gate は同じソケットで request_id の決着を待つ
 *
 * `messages` は daemon がそのセッション宛にキューしてある人間→Claude のメッセージ。
 * gate はこれを hook 出力の additionalContext に埋めて Claude に届ける。
 */
export const DecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("allow"),
    reason: z.string().optional(),
    messages: z.array(MessageSchema).optional(),
  }),
  z.object({
    decision: z.literal("deny"),
    reason: z.string().optional(),
    messages: z.array(MessageSchema).optional(),
  }),
  z.object({
    decision: z.literal("ask"),
    request_id: z.string().uuid(),
    // ask 中の drain は ask resolution と一緒に届く (下記 AskResolutionSchema)
  }),
]);

export type Decision = z.infer<typeof DecisionSchema>;

/**
 * ask だったリクエストが人間 / タイムアウトで決着したとき、
 * daemon が同じソケット上で gate に返すメッセージ。
 */
export const AskResolutionSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["allow", "deny"]),
  reason: z.string().optional(),
  /** ask 待ち中に session 宛に届いたメッセージ。Decision と同じ意味で配送。 */
  messages: z.array(MessageSchema).optional(),
});

export type AskResolution = z.infer<typeof AskResolutionSchema>;

/** 終局的な判定（DB に記録される値）。"ask" 中のものは null。 */
export const FinalDecisionSchema = z.enum(["allow", "deny"]);
export type FinalDecision = z.infer<typeof FinalDecisionSchema>;
