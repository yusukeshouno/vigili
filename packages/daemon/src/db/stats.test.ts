import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyDecisionSource, computeStats, pruneOldRequests } from "./stats.js";
import { openStore, type RequestStore } from "./store.js";

let store: RequestStore;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-stats-"));
  store = openStore(join(dir, "queue.db"));
});

afterEach(() => {
  store.close();
});

function insertResolved(opts: {
  decided_by: string;
  decision: "allow" | "deny";
  tool: string;
  tag: string | null;
  created_at?: number;
  resolved_at?: number;
}): void {
  const id = randomUUID();
  const created = opts.created_at ?? Date.now();
  store.insert({
    id,
    created_at: created,
    session_id: "s",
    session_tag: opts.tag,
    tool_name: opts.tool,
    tool_input: {},
    cwd: "/tmp",
  });
  store.resolve({
    id,
    resolved_at: opts.resolved_at ?? created + 1000,
    decision: opts.decision,
    decided_by: opts.decided_by,
    reason: null,
  });
}

describe("classifyDecisionSource", () => {
  it("classifies all source types", () => {
    expect(classifyDecisionSource(null)).toBe("pending");
    expect(classifyDecisionSource("rule:read-only bash")).toBe("auto-rule");
    expect(classifyDecisionSource("invariant:rm -rf root")).toBe("invariant");
    expect(classifyDecisionSource("default")).toBe("auto-default");
    expect(classifyDecisionSource("human:ws (policy:rule:foo)")).toBe("human-pwa");
    expect(classifyDecisionSource("human:cli")).toBe("human-cli");
    expect(classifyDecisionSource("timeout")).toBe("timeout");
    expect(classifyDecisionSource("cancelled:gate-disconnected")).toBe("cancelled");
    expect(classifyDecisionSource("weird:stuff")).toBe("other");
  });
});

describe("computeStats", () => {
  it("aggregates basic counts", () => {
    insertResolved({ decided_by: "rule:r1", decision: "allow", tool: "Bash", tag: "a" });
    insertResolved({ decided_by: "rule:r1", decision: "allow", tool: "Bash", tag: "a" });
    insertResolved({ decided_by: "human:ws", decision: "allow", tool: "Edit", tag: "b" });
    insertResolved({ decided_by: "invariant:rm", decision: "deny", tool: "Bash", tag: "a" });
    insertResolved({ decided_by: "timeout", decision: "deny", tool: "Bash", tag: "c" });
    const stats = computeStats(store.raw().db, 0, Date.now() + 10_000);
    expect(stats.total).toBe(5);
    expect(stats.by_decision.allow).toBe(3);
    expect(stats.by_decision.deny).toBe(2);
    expect(stats.by_source["auto-rule"]).toBe(2);
    expect(stats.by_source.invariant).toBe(1);
    expect(stats.by_source["human-pwa"]).toBe(1);
    expect(stats.by_source.timeout).toBe(1);
    expect(stats.by_tool.Bash).toBe(4);
    expect(stats.by_tool.Edit).toBe(1);
    expect(stats.by_tag.a).toBe(3);
    expect(stats.by_tag.b).toBe(1);
  });

  it("filters by range", () => {
    const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const recent = Date.now();
    insertResolved({
      decided_by: "rule:x",
      decision: "allow",
      tool: "Bash",
      tag: null,
      created_at: old,
    });
    insertResolved({
      decided_by: "rule:x",
      decision: "allow",
      tool: "Bash",
      tag: null,
      created_at: recent,
    });
    const stats = computeStats(store.raw().db, recent - 60_000, recent + 60_000);
    expect(stats.total).toBe(1);
  });

  it("computes human response latency percentiles", () => {
    const now = Date.now();
    for (const ms of [500, 1000, 2000, 4000, 8000, 16000, 30000]) {
      insertResolved({
        decided_by: "human:ws",
        decision: "allow",
        tool: "Bash",
        tag: "x",
        created_at: now,
        resolved_at: now + ms,
      });
    }
    const stats = computeStats(store.raw().db, 0, now + 60_000);
    expect(stats.human_response_ms.count).toBe(7);
    expect(stats.human_response_ms.p50).toBe(4000);
    expect(stats.human_response_ms.max).toBe(30000);
  });

  it("treats null session_tag as (untagged)", () => {
    insertResolved({ decided_by: "rule:x", decision: "allow", tool: "Bash", tag: null });
    const stats = computeStats(store.raw().db, 0, Date.now() + 10_000);
    expect(stats.by_tag["(untagged)"]).toBe(1);
  });
});

describe("pruneOldRequests", () => {
  it("does not prune when under size limit", () => {
    insertResolved({ decided_by: "rule:x", decision: "allow", tool: "Bash", tag: null });
    const { db, path } = store.raw();
    const result = pruneOldRequests(db, path, {
      maxBytes: 1024 * 1024 * 1024, // 1 GB — way over
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      fs: { statSync: (p: string) => ({ size: 100 }) }, // tiny
    });
    expect(result.pruned).toBe(0);
    expect(result.vacuumed).toBe(false);
  });

  it("prunes old resolved rows when over size limit", () => {
    const ancient = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 日前
    insertResolved({
      decided_by: "rule:x",
      decision: "allow",
      tool: "Bash",
      tag: null,
      created_at: ancient,
      resolved_at: ancient + 1000,
    });
    insertResolved({ decided_by: "rule:x", decision: "allow", tool: "Bash", tag: null });
    const { db, path } = store.raw();
    const result = pruneOldRequests(db, path, {
      maxBytes: 1,
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      fs: {
        statSync: (() => {
          let count = 0;
          return () => ({ size: count++ === 0 ? 1_000_000 : 100 });
        })(),
      },
    });
    expect(result.pruned).toBe(1);
    expect(result.vacuumed).toBe(true);

    // 残った行は新しいほうだけ
    const stats = computeStats(db, 0, Date.now() + 10_000);
    expect(stats.total).toBe(1);
  });
});
