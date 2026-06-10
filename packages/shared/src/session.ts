import { z } from "zod";

/**
 * L4 ホスト型セッション (`vigili run`) の型定義 (SPEC §8.5 / §8.6)。
 *
 * `vigili run` は Claude Code セッションを Agent SDK でホストし、unix socket
 * (`kind:"session"`) で daemon につなぐ。daemon はセッションをレジストリで
 * 管理し、transcript / 選択肢質問 / plan 承認 / permission を WS でクライアント
 * (iOS/Mac/PWA) に fan-out する。回答は逆経路でセッションに返る。
 *
 * ここ shared には zod スキーマだけを置く (CLAUDE.md ディレクトリ規約)。
 */

/** transcript の 1 行。チャット UI の 1 吹き出しに対応する。 */
export const TranscriptLineSchema = z.object({
  role: z.enum(["assistant", "user", "tool", "system"]),
  text: z.string(),
  /** 生成時刻 (UTC, ms)。 */
  at: z.number().int().nonnegative(),
  /** role==="tool" のときのツール名 (任意)。 */
  tool_name: z.string().optional(),
});

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

/** AskUserQuestion の選択肢 1 つ。SDK の option 形と一致させる。 */
export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

/** AskUserQuestion の質問 1 つ。 */
export const QuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(QuestionOptionSchema),
  multiSelect: z.boolean(),
});

export type Question = z.infer<typeof QuestionSchema>;

/** セッションの状態。 */
export const HostedSessionStatusSchema = z.enum(["running", "awaiting", "ended"]);

export type HostedSessionStatus = z.infer<typeof HostedSessionStatusSchema>;

/** daemon が in-memory で持つホスト型セッションの公開ビュー。 */
export const HostedSessionSchema = z.object({
  /** SDK の session_id を採用。 */
  session_id: z.string().min(1),
  tag: z.string().nullable(),
  cwd: z.string(),
  status: HostedSessionStatusSchema,
  started_at: z.number().int().nonnegative(),
  /** true = gate 経由で合成された observed session (SPEC §8.5.1)。
   *  transcript / question / plan / reply を持たない。省略 = hosted (`vigili run`)。 */
  observed: z.boolean().optional(),
});

export type HostedSession = z.infer<typeof HostedSessionSchema>;

const sessionKind = z.literal("session");

/**
 * runner → daemon (unix socket, `kind:"session"`)。
 * 全メッセージが `kind:"session"` を持ち、daemon の handleLine がこれで
 * セッション経路へ振り分ける (admin / tool-request と同じ要領)。
 */
export const SessionRunnerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    kind: sessionKind,
    type: z.literal("session-start"),
    session_id: z.string().min(1),
    tag: z.string().nullable(),
    cwd: z.string(),
  }),
  z.object({
    kind: sessionKind,
    type: z.literal("transcript-append"),
    session_id: z.string().min(1),
    line: TranscriptLineSchema,
  }),
  z.object({
    kind: sessionKind,
    type: z.literal("question"),
    session_id: z.string().min(1),
    request_id: z.string().uuid(),
    questions: z.array(QuestionSchema),
  }),
  z.object({
    kind: sessionKind,
    type: z.literal("permission-request"),
    session_id: z.string().min(1),
    request_id: z.string().uuid(),
    tool_name: z.string().min(1),
    tool_input: z.record(z.unknown()),
    cwd: z.string().optional(),
  }),
  z.object({
    kind: sessionKind,
    type: z.literal("plan"),
    session_id: z.string().min(1),
    request_id: z.string().uuid(),
    plan: z.string(),
  }),
  z.object({
    kind: sessionKind,
    type: z.literal("session-end"),
    session_id: z.string().min(1),
    reason: z.string().optional(),
  }),
]);

export type SessionRunnerMessage = z.infer<typeof SessionRunnerMessageSchema>;

/**
 * daemon → runner (同じ socket 接続上の逆方向)。
 * request_id は runner が question/permission/plan 送信時に発番したものを
 * そのまま echo して対応づける。
 */
export const SessionDaemonMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("answer"),
    request_id: z.string().uuid(),
    answers: z.record(z.string()),
  }),
  z.object({
    type: z.literal("permission-decision"),
    request_id: z.string().uuid(),
    decision: z.enum(["allow", "deny"]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("plan-decision"),
    request_id: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("reply"),
    body: z.string().min(1),
  }),
  z.object({
    type: z.literal("session-error"),
    error: z.string(),
  }),
]);

export type SessionDaemonMessage = z.infer<typeof SessionDaemonMessageSchema>;
