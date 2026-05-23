import type { ApprovalRequest } from "@sentinel/shared";
import { describe, expect, it } from "vitest";
import { createPendingQueue } from "./queue.js";

function makeReq(id: string): ApprovalRequest {
  return {
    id,
    created_at: Date.now(),
    resolved_at: null,
    session_id: "s",
    session_tag: null,
    tool_name: "Bash",
    tool_input: { command: "ls" },
    cwd: "/tmp",
    decision: null,
    decided_by: null,
    reason: null,
  };
}

const ID_A = "00000000-0000-4000-8000-000000000001";
const ID_B = "00000000-0000-4000-8000-000000000002";

describe("PendingQueue", () => {
  it("enroll → resolve unblocks the awaiter", async () => {
    const q = createPendingQueue();
    const p = q.enroll(makeReq(ID_A), 10_000);
    const ok = q.resolve(ID_A, "allow", "human:cli", "ok");
    expect(ok).toBe(true);
    const r = await p;
    expect(r).toEqual({ decision: "allow", source: "human:cli", reason: "ok" });
  });

  it("resolve on unknown id returns false", () => {
    const q = createPendingQueue();
    expect(q.resolve(ID_A, "allow", "x", null)).toBe(false);
  });

  it("times out after the deadline", async () => {
    const q = createPendingQueue();
    const p = q.enroll(makeReq(ID_A), 30);
    const r = await p;
    expect(r.decision).toBe("deny");
    expect(r.source).toBe("timeout");
  });

  it("list returns currently pending requests", async () => {
    const q = createPendingQueue();
    const a = q.enroll(makeReq(ID_A), 10_000);
    const b = q.enroll(makeReq(ID_B), 10_000);
    expect(
      q
        .list()
        .map((r) => r.id)
        .sort(),
    ).toEqual([ID_A, ID_B]);
    q.resolve(ID_A, "deny", "x", null);
    await a;
    expect(q.list().map((r) => r.id)).toEqual([ID_B]);
    q.resolve(ID_B, "allow", "x", null);
    await b;
  });

  it("cancelAll resolves everything to deny", async () => {
    const q = createPendingQueue();
    const p1 = q.enroll(makeReq(ID_A), 10_000);
    const p2 = q.enroll(makeReq(ID_B), 10_000);
    q.cancelAll("shutdown");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.decision).toBe("deny");
    expect(r1.source).toBe("cancelled");
    expect(r2.decision).toBe("deny");
  });

  it("onPending fires on enroll", async () => {
    const q = createPendingQueue();
    const received: string[] = [];
    q.onPending((r) => received.push(r.id));
    void q.enroll(makeReq(ID_A), 100);
    expect(received).toEqual([ID_A]);
  });

  it("onResolved fires on resolve", async () => {
    const q = createPendingQueue();
    const received: Array<{ id: string; decision: string }> = [];
    q.onResolved((id, decision) => received.push({ id, decision }));
    const p = q.enroll(makeReq(ID_A), 10_000);
    q.resolve(ID_A, "allow", "x", null);
    await p;
    expect(received).toEqual([{ id: ID_A, decision: "allow" }]);
  });

  it("second resolve does not re-fire onResolved", async () => {
    const q = createPendingQueue();
    let count = 0;
    q.onResolved(() => count++);
    const p = q.enroll(makeReq(ID_A), 10_000);
    q.resolve(ID_A, "allow", "x", null);
    expect(q.resolve(ID_A, "deny", "x", null)).toBe(false);
    await p;
    expect(count).toBe(1);
  });
});
