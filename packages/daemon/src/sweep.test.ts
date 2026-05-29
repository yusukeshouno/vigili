import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "@vigili/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RequestStore, openStore } from "./db/store.js";
import { type PendingQueue, createPendingQueue } from "./queue.js";
import { DEFAULT_PENDING_TTL_MS, GATE_ASK_TIMEOUT_MS, sweepStalePending } from "./sweep.js";

let store: RequestStore;
let queue: PendingQueue;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vigili-sweep-"));
  store = openStore(join(dir, "queue.db"));
  queue = createPendingQueue();
});

afterEach(() => {
  store.close();
});

function makeReq(id: string, createdAt: number, tag: string): ApprovalRequest {
  return {
    id,
    created_at: createdAt,
    resolved_at: null,
    session_id: "s",
    session_tag: tag,
    tool_name: "Bash",
    tool_input: { command: "ls" },
    cwd: "/tmp",
    decision: null,
    decided_by: null,
    reason: null,
  };
}

/** ApprovalRequest を pending として DB に入れる (insert は決着前フィールドのみ受け取る)。 */
function insertReq(req: ApprovalRequest): void {
  store.insert({
    id: req.id,
    created_at: req.created_at,
    session_id: req.session_id,
    session_tag: req.session_tag,
    tool_name: req.tool_name,
    tool_input: req.tool_input,
    cwd: req.cwd,
  });
}

describe("sweepStalePending", () => {
  it("TTL default sits just above the gate ask timeout", () => {
    // gate (packages/gate) は 300s で諦める。TTL はそれより長くないと
    // 正常応答中のリクエストを誤って expired にしてしまう。
    expect(GATE_ASK_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_PENDING_TTL_MS).toBeGreaterThan(GATE_ASK_TIMEOUT_MS);
  });

  it("expires stale rows, leaves fresh rows, and drops expired from the WS snapshot", async () => {
    const now = Date.now();
    const ttlMs = DEFAULT_PENDING_TTL_MS;
    const oldReq = makeReq(randomUUID(), now - ttlMs - 1, "construal.computer");
    const freshReq = makeReq(randomUUID(), now, "frontend");

    insertReq(oldReq);
    insertReq(freshReq);

    // 両方を queue に enroll → WS snapshot (= queue.list()) に両方載っている状態。
    // gate がまだ生きていることを模す長い timeout を渡す。
    const oldP = queue.enroll(oldReq, 10 * 60_000);
    const freshP = queue.enroll(freshReq, 10 * 60_000);
    expect(
      queue
        .list()
        .map((r) => r.id)
        .sort(),
    ).toEqual([oldReq.id, freshReq.id].sort());

    const swept = sweepStalePending({ store, queue, now, ttlMs });

    // 古い行のみが回収される
    expect(swept.map((r) => r.id)).toEqual([oldReq.id]);
    expect(store.get(oldReq.id)?.decision).toBe("expired");
    expect(store.get(freshReq.id)?.decision).toBeNull();

    // まだ待っていた gate には allow ではなく fail-safe の deny が返る
    await expect(oldP).resolves.toEqual({
      decision: "deny",
      source: "timeout:sweep",
      reason: "gate timed out",
    });

    // WS snapshot (queue.list()) からは expired が消え、fresh だけが残る
    const snapshotPending = queue.list();
    expect(snapshotPending.map((r) => r.id)).toEqual([freshReq.id]);

    // 後始末: 残った fresh の timer を畳んで open handle を残さない
    queue.resolve(freshReq.id, "deny", "test:cleanup", null);
    await freshP;
  });

  it("returns empty and touches nothing when no rows are stale", () => {
    const now = Date.now();
    const freshReq = makeReq(randomUUID(), now, "html");
    insertReq(freshReq);

    const swept = sweepStalePending({ store, queue, now, ttlMs: DEFAULT_PENDING_TTL_MS });
    expect(swept).toEqual([]);
    expect(store.get(freshReq.id)?.decision).toBeNull();
  });
});
