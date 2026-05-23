import { z } from "zod";

/**
 * Vigili の「メッセージ」: 人間が Claude Code に対して送る短文。
 *
 * フロー:
 *   1. PWA で text を打って "send-message" を WS で daemon に送る
 *   2. daemon が messages テーブルに保存 (delivered_at = null)
 *   3. その session の gate が次に発火したとき、daemon が drain して
 *      decision レスポンスに含めて返す
 *   4. gate が hook 出力の additionalContext (PreToolUse) または
 *      decision reason (PermissionRequest) に埋め、Claude が次のターンで読む
 *   5. daemon は drained 分の delivered_at を set し、WS で broadcast
 *
 * - 順序: created_at 昇順で delivery (FIFO)
 * - 各メッセージは exactly-once 配送: 一度 drain したら再配送しない
 * - body は 2000 字まで (Claude のコンテキスト圧迫を避ける)
 */
export const MessageSchema = z.object({
  id: z.string().uuid(),
  /** ターゲットの Claude Code セッション ID。 */
  session_id: z.string().min(1),
  /** 本文。Claude が読む。 */
  body: z.string().min(1).max(2000),
  /** 送信時刻 (UTC, ms)。 */
  created_at: z.number().int().nonnegative(),
  /** drain されて Claude に届けられた時刻。未配送なら null。 */
  delivered_at: z.number().int().nonnegative().nullable(),
});

export type Message = z.infer<typeof MessageSchema>;
