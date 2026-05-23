import type Database from "better-sqlite3";
import { classifyDecisionSource, type DecisionSource } from "./stats.js";

/**
 * 「今日 Claude に何回似た判断をさせられたか」を集計し、
 * ルール昇格に向く候補を提示する。
 *
 * CLAUDE.md「ポリシーは対話的に育つ」を運用面から支援する。
 * 人間が同じパターンを何度も承認/拒否しているなら、ルール化したほうが
 * 翌日以降のタップ数が減らせる。
 */

export interface DigestSample {
  decision: "allow" | "deny" | null;
  decided_by: string | null;
  created_at: number;
  source: DecisionSource;
}

export interface DigestGroup {
  /** 集約キー (例: "Bash:git push", "Edit:.ts", "WebFetch:api.openai.com") */
  key: string;
  tool: string;
  /** 人間表示用ラベル (例: "git push", "*.ts", "api.openai.com") */
  label: string;
  count: number;
  by_decision: { allow: number; deny: number };
  by_source: Record<DecisionSource, number>;
  /** all_human = true なら全件 human-pwa / human-cli。ルール化の有力候補。 */
  all_human: boolean;
  /** すべて同じ decision なら "allow" / "deny"、混ざってれば null。 */
  unanimous: "allow" | "deny" | null;
  /** UI 用に最初の 3 件だけ保持。 */
  samples: DigestSample[];
}

export interface PromoteCandidate {
  group: DigestGroup;
  /** policy.yaml に貼り付けるための YAML 1 ルール (rules: の下) */
  rule_yaml: string;
  /** rule_yaml と等価な構造体 (テスト / プログラム用) */
  rule: PromoteRule;
}

export interface PromoteRule {
  name: string;
  when: {
    tool: string;
    command_matches?: string;
    path_matches?: string;
    url_matches?: string;
  };
  action: "allow" | "deny";
}

export interface DigestReport {
  range: { from: number; to: number };
  /** 件数降順、count >= 2 のグループだけ。 */
  groups: DigestGroup[];
  /** all_human=true かつ unanimous != null かつ count >= 3 のもの。降順。 */
  candidates: PromoteCandidate[];
  /** 上位サマリー (count >= 2 のグループの合計件数 / 全件)。 */
  totals: { in_groups: number; total_rows: number; manual_rows: number };
}

interface Row {
  decision: "allow" | "deny" | null;
  decided_by: string | null;
  created_at: number;
  tool_name: string;
  tool_input: string;
}

const MIN_GROUP_COUNT = 2;
const MIN_CANDIDATE_COUNT = 3;

export function computeDigest(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): DigestReport {
  const rows = db
    .prepare<[number, number]>(
      `SELECT decision, decided_by, created_at, tool_name, tool_input
         FROM approval_requests
        WHERE created_at >= ? AND created_at < ?`,
    )
    .all(fromMs, toMs) as Row[];

  const groups = new Map<string, DigestGroup>();
  let manualRows = 0;

  for (const r of rows) {
    const source = classifyDecisionSource(r.decided_by);
    if (source === "human-pwa" || source === "human-cli") manualRows += 1;

    const parsed = safeParseInput(r.tool_input);
    const grouped = groupKey(r.tool_name, parsed);
    if (!grouped) continue;
    const { key, label } = grouped;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        tool: r.tool_name,
        label,
        count: 0,
        by_decision: { allow: 0, deny: 0 },
        by_source: emptySources(),
        all_human: true,
        unanimous: null,
        samples: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (r.decision === "allow") g.by_decision.allow += 1;
    else if (r.decision === "deny") g.by_decision.deny += 1;
    g.by_source[source] += 1;
    if (source !== "human-pwa" && source !== "human-cli") g.all_human = false;
    if (g.samples.length < 3) {
      g.samples.push({
        decision: r.decision,
        decided_by: r.decided_by,
        created_at: r.created_at,
        source,
      });
    }
  }

  // unanimous を確定
  for (const g of groups.values()) {
    if (g.by_decision.allow > 0 && g.by_decision.deny === 0) g.unanimous = "allow";
    else if (g.by_decision.deny > 0 && g.by_decision.allow === 0) g.unanimous = "deny";
    else g.unanimous = null;
  }

  const sorted = Array.from(groups.values())
    .filter((g) => g.count >= MIN_GROUP_COUNT)
    .sort((a, b) => b.count - a.count);

  const candidates: PromoteCandidate[] = [];
  for (const g of sorted) {
    if (!g.all_human || g.unanimous === null) continue;
    if (g.count < MIN_CANDIDATE_COUNT) continue;
    const rule = ruleFor(g);
    if (!rule) continue;
    candidates.push({ group: g, rule, rule_yaml: renderRuleYaml(rule) });
  }

  return {
    range: { from: fromMs, to: toMs },
    groups: sorted,
    candidates,
    totals: {
      in_groups: sorted.reduce((acc, g) => acc + g.count, 0),
      total_rows: rows.length,
      manual_rows: manualRows,
    },
  };
}

// ---------- グルーピング ----------

function groupKey(
  tool: string,
  input: Record<string, unknown>,
): { key: string; label: string } | null {
  if (tool === "Bash" && typeof input.command === "string") {
    const fam = bashCommandFamily(input.command);
    if (!fam) return null;
    return { key: `Bash:${fam}`, label: fam };
  }
  if ((tool === "Edit" || tool === "Write") && typeof input.file_path === "string") {
    const ext = pathExtension(input.file_path);
    if (!ext) return null;
    return { key: `${tool}:${ext}`, label: `*${ext}` };
  }
  if (tool === "WebFetch" && typeof input.url === "string") {
    const host = urlHost(input.url);
    if (!host) return null;
    return { key: `WebFetch:${host}`, label: host };
  }
  return null;
}

/**
 * "git push origin main" → "git push"
 * "pnpm --filter @vigili/daemon test" → "pnpm" (flag が来たら 1 token で打ち切り)
 * "curl https://api.openai.com" → "curl"
 * "cd /tmp && rm foo" → "cd"
 */
export function bashCommandFamily(cmd: string): string | null {
  const trimmed = cmd.trim();
  if (!trimmed) return null;
  // 最初の 2 token を見て、token2 が "-" で始まる/含む長め文字列なら 1 token で止める。
  const tokens = trimmed.split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const t1 = tokens[0]!;
  if (tokens.length === 1) return t1;
  const t2 = tokens[1]!;
  // flag っぽい / 長すぎる 2nd token は除外して 1 token のみ採用。
  if (t2.startsWith("-")) return t1;
  if (t2.length > 24) return t1;
  // 数字 / 引用符 / パス / URL ({"://" を含む) っぽいのも 1 token。
  if (/^["'/]/u.test(t2)) return t1;
  if (/^\d/u.test(t2)) return t1;
  if (/[:/]/u.test(t2)) return t1; // URL や path:port / username:host が来たら subcommand 扱いしない
  return `${t1} ${t2}`;
}

/**
 * "/Users/x/foo.ts" → ".ts"
 * "/Users/x/.env"  → ".env"
 * "/Users/x/Makefile" → null  (拡張子なしのファイルは諦める。グルーピング困難)
 */
export function pathExtension(p: string): string | null {
  const base = p.split("/").pop() ?? p;
  if (base.startsWith(".")) return base; // .env / .gitignore など
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return null;
  const ext = base.slice(idx);
  if (ext.length > 8) return null; // .someverylongthing は信用しない
  return ext;
}

/** "https://api.openai.com/v1/chat" → "api.openai.com" */
export function urlHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

// ---------- ルール候補 ----------

function ruleFor(g: DigestGroup): PromoteRule | null {
  if (g.unanimous === null) return null;
  const action = g.unanimous;
  if (g.tool === "Bash") {
    const fam = g.label; // "git push" 等
    return {
      name: `digest: ${fam}`,
      when: {
        tool: "Bash",
        command_matches: `^${escapeRegex(fam)}\\b`,
      },
      action,
    };
  }
  if (g.tool === "Edit" || g.tool === "Write") {
    const ext = g.label.replace(/^\*/u, ""); // "*.ts" → ".ts"
    return {
      name: `digest: ${g.tool} ${ext}`,
      when: {
        tool: g.tool,
        path_matches: `${escapeRegex(ext)}$`,
      },
      action,
    };
  }
  if (g.tool === "WebFetch") {
    return {
      name: `digest: WebFetch ${g.label}`,
      when: {
        tool: "WebFetch",
        url_matches: `^https?://${escapeRegex(g.label)}/`,
      },
      action,
    };
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * YAML を手で書く。yaml ライブラリの stringify は安全だが、policy.yaml の慣例的な
 * インデント / クォート位置に揃えるためテンプレートで出す方が運用上素直。
 */
export function renderRuleYaml(rule: PromoteRule): string {
  const lines: string[] = [];
  lines.push(`  - name: "${rule.name}"`);
  lines.push(`    when:`);
  lines.push(`      tool: ${rule.when.tool}`);
  if (rule.when.command_matches !== undefined) {
    lines.push(`      command_matches: '${rule.when.command_matches.replace(/'/gu, "''")}'`);
  }
  if (rule.when.path_matches !== undefined) {
    lines.push(`      path_matches: '${rule.when.path_matches.replace(/'/gu, "''")}'`);
  }
  if (rule.when.url_matches !== undefined) {
    lines.push(`      url_matches: '${rule.when.url_matches.replace(/'/gu, "''")}'`);
  }
  lines.push(`    action: ${rule.action}`);
  return lines.join("\n");
}

// ---------- helpers ----------

function safeParseInput(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return {};
}

function emptySources(): Record<DecisionSource, number> {
  return {
    "auto-rule": 0,
    invariant: 0,
    "auto-default": 0,
    "human-pwa": 0,
    "human-cli": 0,
    timeout: 0,
    cancelled: 0,
    pending: 0,
    other: 0,
  };
}
