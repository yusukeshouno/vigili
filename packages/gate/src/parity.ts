import type { ToolRequest } from "@vigili/shared";

/**
 * ネイティブパリティ・ルーティング (SPEC §2.5)。
 *
 * 「Claude Code 本体ならこの操作で確認を出すか?」を gate 側で再現し、
 * 出さないものは daemon に流さず素通し (無出力 exit 0) する。
 * 素通しは権限を一切付与しない — Claude Code が自前のロジックで許可するだけなので、
 * ここの再現が間違っていても vanilla より緩くなることはない (native prompt に落ちるだけ)。
 *
 * 不変条件: アプリに届く承認要求 ⊆ Claude Code が出すはずだった承認要求。
 */

/**
 * Claude Code が確認なしで実行する組み込みツール (読み取り専用 + 無害な内部操作)。
 *
 * 保守的な固定リスト。迷うものは入れない — 入れ損ねても native フローに
 * 落ちるだけで安全側。ExitPlanMode (プラン承認) のような「確認そのもの」は含めない。
 */
export const NO_PROMPT_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite",
  "TodoRead",
  "WebSearch",
  "Task", // サブエージェント起動自体は確認なし。内部のツール呼び出しは各自 hook を通る
  "AskUserQuestion", // ユーザーへの質問。確認ではなく対話
  "BashOutput", // バックグラウンドシェルの出力読み取り
  "TaskOutput",
  "TaskList",
  "TaskGet",
]);

/** acceptEdits モードで Claude Code が自動承認する編集系ツール。 */
const ACCEPT_EDITS_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
]);

/**
 * 素通しすべきなら理由文字列を、daemon に流すべきなら null を返す。
 *
 * @param permissionMode hook payload の `permission_mode`。
 *   "default" | "acceptEdits" | "plan" | "bypassPermissions" を想定。
 *   未知の値は安全側 (= default 扱いで daemon に流す)。
 */
export function nativeParityPassthrough(
  req: Pick<ToolRequest, "tool_name">,
  permissionMode: string | undefined,
): string | null {
  if (NO_PROMPT_TOOLS.has(req.tool_name)) {
    return `no-prompt builtin tool: ${req.tool_name}`;
  }
  if (permissionMode === "bypassPermissions") {
    // ユーザーが明示的に「確認するな」を選んでいる。phone 通知は純粋な追加摩擦。
    return "permission_mode=bypassPermissions";
  }
  if (permissionMode === "plan") {
    // plan モードは Claude Code 側が読み取り専用に制限済み。
    return "permission_mode=plan";
  }
  if (permissionMode === "acceptEdits" && ACCEPT_EDITS_TOOLS.has(req.tool_name)) {
    return `permission_mode=acceptEdits: ${req.tool_name}`;
  }
  return null;
}
