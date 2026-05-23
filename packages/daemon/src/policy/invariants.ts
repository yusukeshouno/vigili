import type { ToolRequest } from "@vigili/shared";
import { extractCommand } from "./extractors.js";

/**
 * 不変条件 (hardcoded invariants).
 *
 * ユーザーが policy.yaml でこれらを allow に上書きしようとしても、
 * loader が起動時に reject する。CLAUDE.md §"セキュリティ規約" と
 * §"ポリシー設計の不変条件" 参照。
 *
 * 新しい invariant を追加するときは:
 *   1. 必ず deny 方向のみ (allow を強制する invariant は作らない)
 *   2. ここのテストを書く
 *   3. policy loader のオーバーライド検出が効くか確認
 */

export interface Invariant {
  readonly name: string;
  readonly decision: "deny";
  readonly matches: (req: ToolRequest) => boolean;
}

// rm -rf <path-starting-with-/> — captures absolute-path deletes including `/`, `/usr`, `/*`, `/etc/passwd`
const RM_RF_ROOT = /\brm\b[^|;&\n]*?\s-[rRfdv]*[rR][rRfdv]*[fF][rRfdv]*\s+\//u;
// rm -rf <home reference>: `~`, `~/`, `$HOME`, `${HOME}`
const RM_RF_HOME = /\brm\b[^|;&\n]*?\s-[rRfdv]*[rR][rRfdv]*[fF][rRfdv]*\s+(?:~|\$\{?HOME\}?)/u;
// git push --force (or -f / --force-with-lease) targeting a protected branch
const FORCE_PUSH_PROTECTED =
  /\bgit\s+push\b[^\n]*?(?:\s-f\b|\s--force(?:-with-lease)?\b)[^\n]*?\b(?:main|master|production|prod|release)\b/u;

export const INVARIANTS: readonly Invariant[] = [
  {
    name: "rm -rf root",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && RM_RF_ROOT.test(cmd);
    },
  },
  {
    name: "rm -rf home",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && RM_RF_HOME.test(cmd);
    },
  },
  {
    name: "force push to protected branch",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && FORCE_PUSH_PROTECTED.test(cmd);
    },
  },
];

/**
 * リクエストにマッチする invariant を返す。なければ null。
 */
export function matchInvariant(req: ToolRequest): Invariant | null {
  for (const inv of INVARIANTS) {
    if (inv.matches(req)) return inv;
  }
  return null;
}
