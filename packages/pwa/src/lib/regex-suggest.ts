import type { ApprovalRequest, PromoteRule } from "@vigili/shared";

/**
 * 承認待ちリクエストから初期 PromoteRule (正規表現の提案) を生成する。
 * - Bash: 先頭トークンで一致
 * - Edit/Write: ファイルの拡張子で一致
 * - WebFetch: URL のスキーム + ホストで一致
 *
 * いずれもユーザーが PWA で編集できる前提の「叩き台」。
 */
export function suggestRule(req: ApprovalRequest): PromoteRule {
  const tag = req.session_tag;
  if (req.tool_name === "Bash") {
    const cmd = typeof req.tool_input.command === "string" ? req.tool_input.command : "";
    const firstToken = (cmd.match(/^\S+/u)?.[0] ?? "").trim();
    const escaped = escapeRegex(firstToken);
    return {
      rule_name: firstToken ? `Bash: ${firstToken}` : "Bash rule",
      match: {
        tool: "Bash",
        command_matches: firstToken ? `^${escaped}\\b` : "^.+",
        ...(tag ? { repo_in: [tag] } : {}),
      },
    };
  }
  if (req.tool_name === "Edit" || req.tool_name === "Write") {
    const path =
      stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path") ?? "";
    const ext = path.match(/\.[A-Za-z0-9]+$/u)?.[0] ?? "";
    return {
      rule_name: ext ? `${req.tool_name}: ${ext}` : `${req.tool_name} rule`,
      match: {
        tool: req.tool_name,
        path_matches: ext ? `${escapeRegex(ext)}$` : "^.+",
        ...(tag ? { repo_in: [tag] } : {}),
      },
    };
  }
  if (req.tool_name === "WebFetch") {
    const url = stringField(req.tool_input, "url") ?? "";
    let prefix = "^.+";
    try {
      const u = new URL(url);
      prefix = `^https?://${escapeRegex(u.host)}/`;
    } catch {
      // fall through
    }
    return {
      rule_name: "WebFetch: trusted host",
      match: {
        tool: "WebFetch",
        url_matches: prefix,
      },
    };
  }
  return {
    rule_name: `${req.tool_name} rule`,
    match: { tool: req.tool_name },
  };
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** PromoteRule の when ブロックが、引数の req にマッチするかをクライアント側でも検証する (preview 用)。 */
export function ruleMatchesRequest(rule: PromoteRule, req: ApprovalRequest): boolean {
  const w = rule.match;
  if (w.tool !== undefined) {
    const tools = Array.isArray(w.tool) ? w.tool : [w.tool];
    if (!tools.includes(req.tool_name)) return false;
  }
  if (w.command_matches !== undefined) {
    if (req.tool_name !== "Bash") return false;
    const cmd = typeof req.tool_input.command === "string" ? req.tool_input.command : "";
    try {
      if (!new RegExp(w.command_matches, "u").test(cmd)) return false;
    } catch {
      return false;
    }
  }
  if (w.path_matches !== undefined) {
    const p = stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path") ?? "";
    try {
      if (!new RegExp(w.path_matches, "u").test(p)) return false;
    } catch {
      return false;
    }
  }
  if (w.url_matches !== undefined) {
    const u = stringField(req.tool_input, "url") ?? "";
    try {
      if (!new RegExp(w.url_matches, "u").test(u)) return false;
    } catch {
      return false;
    }
  }
  if (w.repo_in !== undefined && req.session_tag !== null) {
    if (!w.repo_in.includes(req.session_tag)) return false;
  }
  return true;
}

export function regexIsValid(src: string): boolean {
  try {
    new RegExp(src, "u");
    return true;
  } catch {
    return false;
  }
}
