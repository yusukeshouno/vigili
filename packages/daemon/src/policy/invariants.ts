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

// ─────────────────────────────────────────────────────────────────────────
// rm -rf 系の検出
//
// フラグの順序・分割・long-form・大文字小文字に依存しないよう、
// 「recursive フラグ」と「force フラグ」を独立に AND 判定する。
// 旧実装は `-rf` の r→f 順序を強制していたため `rm -fr /` や
// `rm -r -f /`、`rm --recursive --force /` をすり抜けていた (security audit 指摘)。
// ─────────────────────────────────────────────────────────────────────────

/** コマンドに rm 呼び出しが含まれるか (語境界、大文字小文字無視)。 */
const HAS_RM = /\brm\b/iu;
/** recursive フラグ: -r / -R / -fr 等の短縮束、または --recursive。 */
const RM_RECURSIVE = /(?:^|\s)-[a-z]*r|--recursive\b/iu;
/** force フラグ: -f / -rf 等の短縮束、または --force。 */
const RM_FORCE = /(?:^|\s)-[a-z]*f|--force\b/iu;
/** 削除対象が root: 先頭の引用符を許容しつつ `/` で始まる絶対パス。 */
const TARGET_ROOT = /\s['"]?\/(?:\s|$|['"]|\w|\*)/u;
/** 削除対象が home: `~` `~/` `$HOME` `${HOME}` (引用符許容)。 */
const TARGET_HOME = /\s['"]?(?:~|\$\{?HOME\}?)/u;

function isRmRecursiveForce(cmd: string): boolean {
  return HAS_RM.test(cmd) && RM_RECURSIVE.test(cmd) && RM_FORCE.test(cmd);
}

// ─────────────────────────────────────────────────────────────────────────
// git push --force → 保護ブランチ の検出
//
// フラグ位置 (前置/後置) や `+refspec` 形式に依存しないよう、
// 「push コマンドである」「force 指定がある」「保護ブランチを参照」を
// 独立に判定する。旧実装は `--force ... <branch>` の順序前提で、
// `git push origin main --force` (後置) と `git push origin +main`
// (refspec force) をすり抜けていた (security audit 指摘)。
// ─────────────────────────────────────────────────────────────────────────

const HAS_GIT_PUSH = /\bgit\b[^\n|;&]*\bpush\b/iu;
/** 明示 force: -f / --force / --force-with-lease (位置非依存)。 */
const PUSH_FORCE_FLAG = /(?:^|\s)-[a-z]*f\b|--force(?:-with-lease)?\b/iu;
const PROTECTED_BRANCH = /\b(?:main|master|production|prod|release)\b/iu;
/** refspec force: `+main` `origin +refs/heads/main` 等 (+ で始まる保護ブランチ)。 */
const PUSH_REFSPEC_FORCE = /\+(?:refs\/heads\/)?(?:main|master|production|prod|release)\b/iu;

function isForcePushProtected(cmd: string): boolean {
  if (!HAS_GIT_PUSH.test(cmd)) return false;
  // (a) 明示 force フラグ + 保護ブランチ名
  if (PUSH_FORCE_FLAG.test(cmd) && PROTECTED_BRANCH.test(cmd)) return true;
  // (b) +refspec 形式 (フラグ無しの強制 push)
  if (PUSH_REFSPEC_FORCE.test(cmd)) return true;
  return false;
}

export const INVARIANTS: readonly Invariant[] = [
  {
    name: "rm -rf root",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && isRmRecursiveForce(cmd) && TARGET_ROOT.test(cmd);
    },
  },
  {
    name: "rm -rf home",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && isRmRecursiveForce(cmd) && TARGET_HOME.test(cmd);
    },
  },
  {
    name: "force push to protected branch",
    decision: "deny",
    matches: (req) => {
      const cmd = extractCommand(req);
      return cmd !== undefined && isForcePushProtected(cmd);
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
