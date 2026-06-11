import type { ToolRequest } from "@vigili/shared";
import { type CommandSegment, scanCommand } from "./command-scan.js";
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
//
// 照合はコマンド全文ではなく scanCommand() が返す「コマンド位置」の
// セグメント単位で行う。コミットメッセージのヒアドキュメントや
// echo の文字列リテラルに危険パターンが書かれているだけでは
// マッチしない (誤検知修正)。$()/バッククォート/bash -c/eval の中身、
// 未終端ヒアドキュメントは安全側に倒して走査対象に含まれる。
// ─────────────────────────────────────────────────────────────────────────

/** recursive フラグ: -r / -R / -fr 等の短縮束、または --recursive。 */
const RM_RECURSIVE = /(?:^|\s)-[a-z]*r|--recursive\b/iu;
/** force フラグ: -f / -rf 等の短縮束、または --force。 */
const RM_FORCE = /(?:^|\s)-[a-z]*f|--force\b/iu;
/** 削除対象が root: 先頭の引用符を許容しつつ `/` で始まる絶対パス。 */
const TARGET_ROOT = /\s['"]?\/(?:\s|$|['"]|\w|\*)/u;
/** 削除対象が home: `~` `~/` `$HOME` `${HOME}` (引用符許容)。 */
const TARGET_HOME = /\s['"]?(?:~|\$\{?HOME\}?)/u;

/**
 * rm を recursive+force で呼び出しているセグメントを返す。
 * xargs 経由の場合は削除対象が stdin から来るため、target 照合用に
 * パイプライン全体のテキストを合成して返す (安全側)。
 */
function rmRecursiveForceTexts(segments: readonly CommandSegment[]): string[] {
  const all = segments.map((s) => s.text).join(" ");
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg.names.has("rm")) continue;
    if (!(RM_RECURSIVE.test(seg.text) && RM_FORCE.test(seg.text))) continue;
    out.push(seg.viaXargs ? `${seg.text} ${all}` : seg.text);
  }
  return out;
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

/** 明示 force: -f / --force / --force-with-lease (位置非依存)。 */
const PUSH_FORCE_FLAG = /(?:^|\s)-[a-z]*f\b|--force(?:-with-lease)?\b/iu;
const PROTECTED_BRANCH = /\b(?:main|master|production|prod|release)\b/iu;
/** refspec force: `+main` `origin +refs/heads/main` 等 (+ で始まる保護ブランチ)。 */
const PUSH_REFSPEC_FORCE = /\+(?:refs\/heads\/)?(?:main|master|production|prod|release)\b/iu;

function isForcePushProtected(segments: readonly CommandSegment[]): boolean {
  for (const seg of segments) {
    // push サブコマンドは引用符外のトークンとして現れた場合のみ。
    // (git commit -m "... push --force ... main" のメッセージ誤検知を防ぐ)
    if (!(seg.names.has("git") && seg.bareTokens.has("push"))) continue;
    // (a) 明示 force フラグ + 保護ブランチ名
    if (PUSH_FORCE_FLAG.test(seg.text) && PROTECTED_BRANCH.test(seg.text)) return true;
    // (b) +refspec 形式 (フラグ無しの強制 push)
    if (PUSH_REFSPEC_FORCE.test(seg.text)) return true;
  }
  return false;
}

function segmentsOf(req: ToolRequest): readonly CommandSegment[] | undefined {
  const cmd = extractCommand(req);
  return cmd === undefined ? undefined : scanCommand(cmd);
}

export const INVARIANTS: readonly Invariant[] = [
  {
    name: "rm -rf root",
    decision: "deny",
    matches: (req) => {
      const segs = segmentsOf(req);
      return segs !== undefined && rmRecursiveForceTexts(segs).some((t) => TARGET_ROOT.test(t));
    },
  },
  {
    name: "rm -rf home",
    decision: "deny",
    matches: (req) => {
      const segs = segmentsOf(req);
      return segs !== undefined && rmRecursiveForceTexts(segs).some((t) => TARGET_HOME.test(t));
    },
  },
  {
    name: "force push to protected branch",
    decision: "deny",
    matches: (req) => {
      const segs = segmentsOf(req);
      return segs !== undefined && isForcePushProtected(segs);
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
