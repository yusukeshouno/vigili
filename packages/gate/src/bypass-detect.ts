import { execFileSync } from "node:child_process";

/**
 * skip-permissions フラグの検出 (SPEC §2.5)。
 *
 * `claude --dangerously-skip-permissions` (デスクトップアプリ経由では
 * `--allow-dangerously-skip-permissions`) で起動されたセッションは、Claude Code
 * 本体が一切確認を出さない。しかし hook payload の `permission_mode` には
 * このフラグが反映されない (acceptEdits 等のまま) ため、payload だけでは
 * パリティ判定できない。
 *
 * そこで gate の祖先プロセス (hook を spawn した claude プロセス) のコマンドラインを
 * 遡って検査する。誤検知しても素通し → native フロー (確認が出る) に落ちるだけで、
 * vanilla より緩くなることはない。
 */

const SKIP_FLAG_RE = /--(?:allow-)?dangerously-skip-permissions(?:\s|$|=)/;

/** コマンドライン文字列に skip-permissions フラグが含まれるか。 */
export function hasSkipPermissionsFlag(cmdline: string): boolean {
  return SKIP_FLAG_RE.test(cmdline);
}

/**
 * 祖先プロセスのいずれかが skip-permissions フラグ付きで動いているか。
 * gate → (sh) → claude という浅いツリーを想定し、maxDepth で打ち切る。
 * ps が使えない・タイムアウトした場合は false (= daemon に流す通常経路)。
 */
export function ancestorHasSkipPermissions(
  startPid: number = process.ppid,
  maxDepth = 6,
): boolean {
  let pid = startPid;
  for (let i = 0; i < maxDepth && pid > 1; i++) {
    let out: string;
    try {
      out = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], {
        encoding: "utf-8",
        timeout: 1000,
      });
    } catch {
      return false;
    }
    // command にはシェルスナップショット等で改行が混ざりうるので全体を見る。
    const m = out.match(/^\s*(\d+)\s+([\s\S]*)$/);
    if (!m || m[1] === undefined || m[2] === undefined) return false;
    if (hasSkipPermissionsFlag(m[2])) return true;
    pid = Number(m[1]);
  }
  return false;
}
