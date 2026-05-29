import type { PolicyAction, PolicyConfig, PolicyRule, ToolRequest } from "@vigili/shared";
import { extractCommand, extractPath, extractUrl, inferRepoTag } from "./extractors.js";
import { matchInvariant } from "./invariants.js";

/**
 * 判定結果。daemon の内部表現。
 * - "ask" の場合は queue に積む必要がある。
 * - source は監査ログの decided_by に入る。
 */
export interface DecisionResult {
  action: PolicyAction;
  /** 'invariant:<name>' | 'rule:<name>' | 'default' */
  source: string;
  reason?: string;
  notify?: "normal" | "critical";
  /** マッチしたルールの when ブロック（promote 提案に使う）。 */
  matchedRule?: PolicyRule;
}

export interface DecideContext {
  /** JST の HH:MM 比較に使う「今」時刻。テスト時に注入できる。 */
  now?: Date;
  /** config.yaml の session_tags マップ。 */
  sessionTags?: Record<string, string>;
}

export function decide(
  req: ToolRequest,
  policy: PolicyConfig,
  ctx: DecideContext = {},
): DecisionResult {
  // 1. invariants が最優先
  const inv = matchInvariant(req);
  if (inv) {
    return {
      action: inv.decision,
      source: `invariant:${inv.name}`,
      reason: "ハードコード不変条件によるブロック",
    };
  }

  // 2. ルールを上から評価、最初にマッチしたもの
  const now = ctx.now ?? new Date();
  for (const rule of policy.rules) {
    // 期限切れルールはスキップ
    if (rule.expires_at !== undefined && new Date(rule.expires_at) < now) continue;
    if (ruleMatches(rule, req, ctx)) {
      return {
        action: rule.action,
        source: `rule:${rule.name}`,
        ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
        ...(rule.notify !== undefined ? { notify: rule.notify } : {}),
        matchedRule: rule,
      };
    }
  }

  // 3. default
  return {
    action: policy.defaults.unknown,
    source: "default",
    reason: "どのルールにもマッチしませんでした",
  };
}

function ruleMatches(rule: PolicyRule, req: ToolRequest, ctx: DecideContext): boolean {
  const w = rule.when;

  if (w.tool !== undefined) {
    const tools = Array.isArray(w.tool) ? w.tool : [w.tool];
    if (!tools.includes(req.tool_name)) return false;
  }

  if (w.command_matches !== undefined) {
    const cmd = extractCommand(req);
    if (cmd === undefined) return false;
    if (!safeRegex(w.command_matches).test(cmd)) return false;
  }

  if (w.path_matches !== undefined) {
    const p = extractPath(req);
    if (p === undefined) return false;
    if (!safeRegex(w.path_matches).test(p)) return false;
  }

  if (w.url_matches !== undefined) {
    const u = extractUrl(req);
    if (u === undefined) return false;
    if (!safeRegex(w.url_matches).test(u)) return false;
  }

  if (w.repo_in !== undefined) {
    const tag = inferRepoTag(req, ctx.sessionTags ?? {});
    if (!w.repo_in.includes(tag)) return false;
  }

  if (w.time_between !== undefined) {
    if (!isWithinJstWindow(w.time_between[0], w.time_between[1], ctx.now ?? new Date())) {
      return false;
    }
  }

  return true;
}

/**
 * 正規表現は YAML 由来のユーザー入力。コンストラクト失敗を catch して
 * "マッチしない" として扱う (ルールの誤記が静かに skip される — 起動時に loader 側でも検証する)。
 */
function safeRegex(src: string): RegExp {
  try {
    return new RegExp(src, "u");
  } catch {
    return /a^/u; // 何にもマッチしない sentinel
  }
}

/** "HH:MM" を JST 上の分数に変換。 */
function hhmmToMinutes(hhmm: string): number {
  const colonIdx = hhmm.indexOf(":");
  const h = Number(hhmm.slice(0, colonIdx));
  const m = Number(hhmm.slice(colonIdx + 1));
  return h * 60 + m;
}

/**
 * now が JST タイムゾーンで [start, end] (両端含む) のウィンドウに入るか。
 * start > end のときは「日をまたぐ」と解釈 (例: 22:00 → 06:00)。
 */
export function isWithinJstWindow(start: string, end: string, now: Date): boolean {
  const jstMinutes = jstMinutesOf(now);
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s <= e) {
    return jstMinutes >= s && jstMinutes <= e;
  }
  return jstMinutes >= s || jstMinutes <= e;
}

function jstMinutesOf(date: Date): number {
  // JST = UTC+9。getUTCMinutes/Hours から JST を算出する。
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + 9 * 60) % (24 * 60);
}
