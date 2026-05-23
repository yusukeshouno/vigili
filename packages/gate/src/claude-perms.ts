import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolRequest } from "@vigili/shared";

/**
 * Claude Code の "permissions.allow" / "permissions.deny" に登録された
 * パターンと、PreToolUse hook で来た ToolRequest を照合する。
 *
 * Claude Code が本来 **自動許可するもの** に match した場合、Sentinel は介入せず
 * 即 exit 0 を返したい (これで PWA の承認頻度が Claude Code 本体と揃う)。
 *
 * パターン形式 (Claude Code の settings.json 仕様):
 *   - "Bash(pnpm -r typecheck)"   → 完全一致
 *   - "Bash(pnpm lint *)"         → "pnpm lint " で始まる
 *   - "Bash(git status*)"         → "git status" で始まる
 *   - "Edit(*.tsx)"               → file path glob
 *   - "WebFetch(domain:github.com)" → host or subdomain match
 *
 * `*` はワイルドカード (任意 0+ 文字)。それ以外の正規表現メタは literal 扱い。
 */

export interface ClaudePermissions {
  allow: string[];
  deny: string[];
}

const EMPTY: ClaudePermissions = { allow: [], deny: [] };

/**
 * ~/.claude/settings.json と $cwd/.claude/settings{,.local}.json の
 * permissions.allow / .deny を集める。失敗した個別ファイルは無視。
 */
export function loadClaudePermissions(cwd: string): ClaudePermissions {
  const candidates = [
    join(homedir(), ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
  const allow: string[] = [];
  const deny: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as {
        permissions?: { allow?: unknown; deny?: unknown };
      };
      const a = parsed.permissions?.allow;
      const d = parsed.permissions?.deny;
      if (Array.isArray(a)) for (const x of a) if (typeof x === "string") allow.push(x);
      if (Array.isArray(d)) for (const x of d) if (typeof x === "string") deny.push(x);
    } catch {
      // 壊れた JSON はスキップ (起動失敗にしない)
    }
  }
  return { allow, deny };
}

export interface MatchResult {
  matched: boolean;
  reason: "allow" | "deny" | "no-match";
  pattern?: string;
}

/**
 * permissions のパターンと ToolRequest を照合。
 * deny が先に評価される (Claude Code 仕様)。
 */
export function matchClaudePermissions(perms: ClaudePermissions, req: ToolRequest): MatchResult {
  for (const pat of perms.deny) {
    if (patternMatches(pat, req)) return { matched: true, reason: "deny", pattern: pat };
  }
  for (const pat of perms.allow) {
    if (patternMatches(pat, req)) return { matched: true, reason: "allow", pattern: pat };
  }
  return { matched: false, reason: "no-match" };
}

/**
 * "Tool(inside)" の形を分解し、tool と inside パターンを照合。
 * inside の `*` を `.*` に変換 (それ以外の regex メタは escape)。
 */
function patternMatches(pattern: string, req: ToolRequest): boolean {
  const parsed = parsePermission(pattern);
  if (!parsed) return false;
  const { tool, inside } = parsed;
  if (tool === "*") {
    // 全 tool を対象とするワイルドカード
    return testAnyValue(inside, req);
  }
  if (tool !== req.tool_name) return false;
  return testAnyValue(inside, req);
}

/** "Bash(...)" → { tool: "Bash", inside: "..." } */
function parsePermission(pattern: string): { tool: string; inside: string } | null {
  // 末尾 ")" がない場合は tool 名のみとみなす
  const m = /^([A-Za-z*]+)(?:\((.*)\))?$/u.exec(pattern.trim());
  if (!m) return null;
  return { tool: m[1] ?? "", inside: m[2] ?? "" };
}

/**
 * inside パターンと ToolRequest の照合。
 *  - Bash: command と照合
 *  - Edit/Write: file_path と照合 (or "path:..." prefix を取り除いて照合)
 *  - WebFetch: url と照合 (or "domain:..." はホスト一致)
 *  - inside === "" → tool 名一致だけで合致 (例: "Bash" 単体)
 */
function testAnyValue(inside: string, req: ToolRequest): boolean {
  if (inside === "") return true;

  // "key:rest" 形式の解釈
  const colon = inside.indexOf(":");
  let key: string | null = null;
  let value = inside;
  if (colon > 0 && colon < 16) {
    key = inside.slice(0, colon).toLowerCase();
    value = inside.slice(colon + 1);
  }

  const target = pickTarget(req, key);
  if (target === undefined) return false;

  // domain: 形式は完全一致 + サブドメイン許可
  if (key === "domain") {
    try {
      const u = new URL(target);
      return u.host === value || u.host.endsWith(`.${value}`);
    } catch {
      return false;
    }
  }

  // それ以外は glob → regex
  const re = globToRegex(value);
  return re.test(target);
}

function pickTarget(req: ToolRequest, key: string | null): string | undefined {
  if (req.tool_name === "Bash") {
    return stringField(req.tool_input, "command");
  }
  if (req.tool_name === "Edit" || req.tool_name === "Write") {
    return stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path");
  }
  if (req.tool_name === "WebFetch") {
    return stringField(req.tool_input, "url");
  }
  // 未知 tool は key で fallback
  if (key) return stringField(req.tool_input, key);
  return undefined;
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Claude Code 風 glob を RegExp に。
 *  - `*`  → 任意 0+ 文字 (`/` も含む)
 *  - その他正規表現メタは escape
 *  - 完全一致 (^…$ で囲う)
 */
export function globToRegex(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") {
      out += ".*";
    } else if (/[.+?^${}()|[\]\\]/u.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out, "u");
}
