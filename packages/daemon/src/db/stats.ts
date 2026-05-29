import type Database from "better-sqlite3";

/**
 * approval_requests テーブルから集計。
 *
 * 意図: 1 日 / 期間使い終えた時に「Sentinel が何件自動許可して、何回スマホを叩いたか」
 *       を一目で把握できるようにする。CLAUDE.md「観測可能性を最優先」の柱。
 */

/** decided_by 文字列をざっくり 6 種類に分類する。 */
export type DecisionSource =
  | "auto-rule" //   rule:<name>  (policy.yaml で自動許可/拒否)
  | "invariant" //   invariant:<name>  (rm -rf / 等)
  | "auto-default" // default  (どのルールにもマッチせず defaults.unknown 適用)
  | "human-pwa" //  human:ws  (PWA で承認/拒否)
  | "human-cli" //  human:cli (sentinel-cli approve/deny)
  | "timeout" //    timeout (応答待ちで自動 deny)
  | "cancelled" //  cancelled:* (gate 切断等)
  | "pending" //    まだ未決
  | "other";

export interface StatsBuckets {
  total: number;
  /**
   * decision の集計。
   * - allow/deny: Vigili が明示的に判定したもの (policy or human via Vigili)
   * - cancelled: gate 切断 (Claude Code dialog で先に承認された等の外部要因) — deny にカウントしない
   * - pending: まだ未決
   */
  by_decision: { allow: number; deny: number; cancelled: number; pending: number };
  by_source: Record<DecisionSource, number>;
  by_tool: Record<string, number>;
  by_tag: Record<string, number>;
  /** 人間が応答した case の resolved_at - created_at の分布 (ms)。 */
  human_response_ms: {
    count: number;
    mean: number | null;
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
  /** 集計対象範囲 (UTC ms)。 */
  range: { from: number; to: number };
}

export function classifyDecisionSource(decidedBy: string | null): DecisionSource {
  if (!decidedBy) return "pending";
  // 先頭スペースまでを source とみなす ("human:ws (policy:rule:foo)" → "human:ws")
  const head = decidedBy.split(/\s/u)[0] ?? decidedBy;
  if (head.startsWith("rule:")) return "auto-rule";
  if (head.startsWith("invariant:")) return "invariant";
  if (head === "default") return "auto-default";
  if (head === "human:ws") return "human-pwa";
  if (head === "human:cli") return "human-cli";
  if (head === "timeout") return "timeout";
  if (head.startsWith("cancelled:")) return "cancelled";
  return "other";
}

const EMPTY_SOURCES: Record<DecisionSource, number> = {
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

interface Row {
  decision: "allow" | "deny" | null;
  decided_by: string | null;
  created_at: number;
  resolved_at: number | null;
  tool_name: string;
  session_tag: string | null;
}

export function computeStats(db: Database.Database, fromMs: number, toMs: number): StatsBuckets {
  const rows = db
    .prepare<[number, number]>(
      `SELECT decision, decided_by, created_at, resolved_at, tool_name, session_tag
         FROM approval_requests
        WHERE created_at >= ? AND created_at < ?`,
    )
    .all(fromMs, toMs) as Row[];

  const stats: StatsBuckets = {
    total: rows.length,
    by_decision: { allow: 0, deny: 0, cancelled: 0, pending: 0 },
    by_source: { ...EMPTY_SOURCES },
    by_tool: {},
    by_tag: {},
    human_response_ms: { count: 0, mean: null, p50: null, p95: null, max: null },
    range: { from: fromMs, to: toMs },
  };

  const humanLatencies: number[] = [];

  for (const r of rows) {
    const src = classifyDecisionSource(r.decided_by);

    // 外部要因による cancellation は deny にカウントしない (Claude Code dialog 等)
    if (src === "cancelled") stats.by_decision.cancelled += 1;
    else if (r.decision === "allow") stats.by_decision.allow += 1;
    else if (r.decision === "deny") stats.by_decision.deny += 1;
    else stats.by_decision.pending += 1;

    stats.by_source[src] += 1;

    stats.by_tool[r.tool_name] = (stats.by_tool[r.tool_name] ?? 0) + 1;
    const tag = r.session_tag ?? "(untagged)";
    stats.by_tag[tag] = (stats.by_tag[tag] ?? 0) + 1;

    if ((src === "human-pwa" || src === "human-cli") && r.resolved_at !== null) {
      humanLatencies.push(r.resolved_at - r.created_at);
    }
  }

  if (humanLatencies.length > 0) {
    humanLatencies.sort((a, b) => a - b);
    stats.human_response_ms.count = humanLatencies.length;
    stats.human_response_ms.mean = mean(humanLatencies);
    stats.human_response_ms.p50 = percentile(humanLatencies, 0.5);
    stats.human_response_ms.p95 = percentile(humanLatencies, 0.95);
    stats.human_response_ms.max = humanLatencies[humanLatencies.length - 1] ?? null;
  }

  return stats;
}

function mean(sorted: number[]): number {
  let sum = 0;
  for (const x of sorted) sum += x;
  return Math.round(sum / sorted.length);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx] ?? null;
}

/**
 * DB ファイルが size 上限を超えていたら、cutoffMs より古いレコードを削除する。
 * CLAUDE.md: 100MB 超で 30 日以前を消す。
 *
 * @returns 削除した行数 (0 のときは prune しなかった)
 */
export interface PruneResult {
  pruned: number;
  sizeBefore: number;
  sizeAfter: number;
  vacuumed: boolean;
}

export function pruneOldRequests(
  db: Database.Database,
  dbPath: string,
  options: {
    maxBytes: number;
    olderThanMs: number;
    fs: { statSync: (p: string) => { size: number } };
  },
): PruneResult {
  const sizeBefore = options.fs.statSync(dbPath).size;
  if (sizeBefore <= options.maxBytes) {
    return { pruned: 0, sizeBefore, sizeAfter: sizeBefore, vacuumed: false };
  }
  const cutoff = Date.now() - options.olderThanMs;
  const info = db
    .prepare<[number]>(
      `DELETE FROM approval_requests WHERE created_at < ? AND decision IS NOT NULL`,
    )
    .run(cutoff);
  let vacuumed = false;
  if (info.changes > 0) {
    db.exec("VACUUM");
    vacuumed = true;
  }
  const sizeAfter = options.fs.statSync(dbPath).size;
  return { pruned: info.changes, sizeBefore, sizeAfter, vacuumed };
}
