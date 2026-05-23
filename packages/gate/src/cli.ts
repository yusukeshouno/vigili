#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ToolRequestSchema } from "@sentinel/shared";
import { loadClaudePermissions, matchClaudePermissions } from "./claude-perms.js";
import { GateConnectionError, sendToDaemon } from "./client.js";

// SENTINEL_GATE_DEBUG=1 で ~/.sentinel/gate.log に時系列ログを残す。
// Claude Code との実時間挙動を追跡するための裏ログ。
const DEBUG_LOG = process.env.SENTINEL_GATE_DEBUG === "1";
const DEBUG_LOG_PATH = join(homedir(), ".sentinel", "gate.log");
function dbg(...parts: unknown[]): void {
  if (!DEBUG_LOG) return;
  try {
    const ts = new Date().toISOString();
    const line = `${ts} [pid=${process.pid}] ${parts
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join(" ")}\n`;
    if (existsSync(DEBUG_LOG_PATH) || true) {
      appendFileSync(DEBUG_LOG_PATH, line);
    }
  } catch {
    // ignore
  }
}

interface ParsedArgs {
  session?: string;
  tag?: string;
  socketPath: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const home = process.env.SENTINEL_HOME ?? join(homedir(), ".sentinel");
  const result: ParsedArgs = {
    socketPath: process.env.SENTINEL_SOCKET ?? join(home, "daemon.sock"),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--session" && next !== undefined) {
      result.session = next;
      i++;
    } else if (arg === "--tag" && next !== undefined) {
      result.tag = next;
      i++;
    } else if (arg === "--socket" && next !== undefined) {
      result.socketPath = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }
  return result;
}

function printHelp(): void {
  console.error(`Usage: sentinel-gate [--session ID] [--tag TAG]

stdin から Claude Code の PreToolUse hook JSON を読み、daemon 経由で
allow / deny を決定して exit code を返す短命 CLI。

Flags:
  --session ID      Claude Code セッション ID (CLAUDE_SESSION_ID から取る)
  --tag TAG         セッションタグ (省略時は cwd basename を使う)
  --socket PATH     daemon socket のパス (default: ~/.sentinel/daemon.sock)
  -h, --help        この help を表示

Exit codes:
  0  allow (Claude Code に実行を許可)
  2  deny  (Claude Code は実行を中止)
  1  内部エラー (Claude Code は標準フォールバックプロンプトを出す)

Env:
  SENTINEL_HOME     ~/.sentinel の代わりに使うディレクトリ
  SENTINEL_SOCKET   daemon socket のパス (--socket より優先度低い)
`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<number> {
  dbg("start", process.argv.slice(2));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const raw = await readStdin();
  dbg("stdin bytes:", raw.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[sentinel-gate] stdin が JSON ではありません: ${(err as Error).message}`);
    return 2;
  }

  // hook_event_name は PreToolUse か PermissionRequest。
  // Claude Code は両方の event で異なる JSON 形式を期待する。
  const hookEventRaw =
    parsed !== null && typeof parsed === "object"
      ? (parsed as { hook_event_name?: unknown }).hook_event_name
      : undefined;
  const hookEvent: "PreToolUse" | "PermissionRequest" =
    hookEventRaw === "PermissionRequest" ? "PermissionRequest" : "PreToolUse";
  dbg("hook event:", hookEvent);

  // hook ペイロードに session/tag フラグの値を埋め込む。
  if (parsed !== null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (args.session !== undefined && obj.session_id === undefined) {
      obj.session_id = args.session;
    }
    if (args.tag !== undefined) {
      obj.session_tag = args.tag;
    } else if (obj.session_tag === undefined && typeof obj.cwd === "string") {
      obj.session_tag = basename(obj.cwd);
    }
  }

  const reqResult = ToolRequestSchema.safeParse(parsed);
  if (!reqResult.success) {
    console.error(
      `[sentinel-gate] hook ペイロードが ToolRequest として不正: ${reqResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return 2;
  }

  dbg("tool:", reqResult.data.tool_name, "tag:", reqResult.data.session_tag);

  // Claude Code 本体が permissions.allow / .deny で既に判断するものは
  // daemon に流さず即決する。これで PWA の承認頻度を Claude Code 本体に揃える。
  const perms = loadClaudePermissions(reqResult.data.cwd);
  const permMatch = matchClaudePermissions(perms, reqResult.data);
  if (permMatch.matched) {
    if (permMatch.reason === "deny") {
      emitHookDecision("deny", `claude permissions.deny "${permMatch.pattern}"`, hookEvent);
      console.error(`[sentinel-gate] deny: claude permissions.deny "${permMatch.pattern}"`);
      dbg("claude-perms deny pattern:", permMatch.pattern, "→ exit 2");
      return 2;
    }
    // claude.allow 該当 → 明示的に allow を出して Claude Code 自身の確認を抑制
    emitHookDecision("allow", `claude permissions.allow "${permMatch.pattern}"`, hookEvent);
    dbg("claude-perms allow pattern:", permMatch.pattern, "→ exit 0");
    return 0;
  }

  dbg("sending to daemon socket:", args.socketPath);
  try {
    const result = await sendToDaemon(reqResult.data, {
      socketPath: args.socketPath,
      trace: (event, detail) => dbg("daemon trace:", event, detail),
    });
    dbg("daemon result:", result);
    if (result.decision === "allow") {
      emitHookDecision("allow", result.reason ?? "approved via Sentinel", hookEvent);
      if (result.reason) console.error(`[sentinel-gate] allow: ${result.reason}`);
      dbg("→ exit 0 (allow JSON emitted to stdout)");
      return 0;
    }
    emitHookDecision("deny", result.reason ?? "denied via Sentinel", hookEvent);
    console.error(`[sentinel-gate] deny${result.reason ? `: ${result.reason}` : ""}`);
    dbg("→ exit 2 (deny)");
    return 2;
  } catch (err) {
    dbg("error:", (err as Error).message);
    if (err instanceof GateConnectionError) {
      console.error(`[sentinel-gate] daemon 通信エラー: ${err.message}`);
      // フェイルセーフ deny (CLAUDE.md セキュリティ規約)
      emitHookDecision("deny", `daemon unreachable: ${err.message}`, hookEvent);
      return 2;
    }
    console.error(`[sentinel-gate] 想定外エラー: ${(err as Error).message}`);
    emitHookDecision("deny", `internal error: ${(err as Error).message}`, hookEvent);
    return 2;
  }
}

/**
 * Claude Code の PreToolUse hook v2 仕様で stdout に JSON を出力すると、
 * Claude Code 自身の承認ダイアログがスキップされ、ここで判定が確定する。
 *
 * - `hookSpecificOutput.permissionDecision: "allow"` → ツール実行が即進む
 * - `hookSpecificOutput.permissionDecision: "deny"`  → ツール実行が止まる + reason が表示される
 * - 古い `decision: "approve" | "block"` フィールドも併記して旧バージョンと互換
 *
 * stdout だけが Claude Code に解釈される。stderr は人間向けログ。
 */
function emitHookDecision(
  verdict: "allow" | "deny",
  reason: string,
  hookEvent: "PreToolUse" | "PermissionRequest",
): void {
  // Claude Code は hook イベントごとに JSON 形式が異なる。
  //  - PreToolUse:       hookSpecificOutput.permissionDecision: "allow"|"deny"|"ask"|"defer"
  //  - PermissionRequest: hookSpecificOutput.decision: { behavior: "allow"|"deny" }
  // stdout には JSON だけを書く (改行なし、strict パーサ対応)。
  let payload: unknown;
  if (hookEvent === "PermissionRequest") {
    payload = {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest" as const,
        decision: {
          behavior: verdict,
          ...(verdict === "deny" ? { message: reason } : {}),
        },
      },
    };
  } else {
    payload = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: verdict,
        permissionDecisionReason: reason,
      },
    };
  }
  const json = JSON.stringify(payload);
  process.stdout.write(json);
  dbg("emitted:", hookEvent, json);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
