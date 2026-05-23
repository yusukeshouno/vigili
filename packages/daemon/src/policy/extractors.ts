import { basename } from "node:path";
import type { ToolRequest } from "@vigili/shared";

/**
 * Claude Code の tool_input は ToolRequest 内では Record<string, unknown> として保持される。
 * ここでツール別に「ポリシー判定に使う値」を取り出す。
 *
 * Claude Code の現行仕様:
 *   Bash      -> { command: string, description?: string }
 *   Edit      -> { file_path: string, ... }
 *   Write     -> { file_path: string, content: string }
 *   WebFetch  -> { url: string, prompt?: string }
 */

function pickString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

export function extractCommand(req: ToolRequest): string | undefined {
  if (req.tool_name !== "Bash") return undefined;
  return pickString(req.tool_input, "command");
}

export function extractPath(req: ToolRequest): string | undefined {
  if (req.tool_name !== "Edit" && req.tool_name !== "Write") return undefined;
  return pickString(req.tool_input, "file_path") ?? pickString(req.tool_input, "path");
}

export function extractUrl(req: ToolRequest): string | undefined {
  if (req.tool_name !== "WebFetch") return undefined;
  return pickString(req.tool_input, "url");
}

/**
 * session_tag が無いリクエストに対して cwd basename からタグを推測する。
 * config.yaml の session_tags マップを渡すと優先される。
 */
export function inferRepoTag(req: ToolRequest, sessionTags: Record<string, string> = {}): string {
  if (req.session_tag) return req.session_tag;
  const base = basename(req.cwd);
  return sessionTags[base] ?? base;
}
