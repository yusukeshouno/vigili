import type { HostedSession } from "@vigili/shared";
import { describe, expect, it } from "vitest";
import { type SessionConn, createSessionRegistry } from "./sessions.js";

/** テスト用の偽 conn。send されたメッセージを記録し、isClosed を切り替えられる。 */
function makeConn(): SessionConn & { sent: unknown[]; closed: boolean } {
  return {
    sent: [] as unknown[],
    closed: false,
    send(value: unknown): void {
      this.sent.push(value);
    },
    isClosed(): boolean {
      return this.closed;
    },
  };
}

function makeSession(id: string): HostedSession {
  return {
    session_id: id,
    tag: null,
    cwd: "/tmp",
    status: "running",
    started_at: Date.now(),
  };
}

const RID_A = "00000000-0000-4000-8000-0000000000a1";
const RID_B = "00000000-0000-4000-8000-0000000000b2";

describe("SessionRegistry", () => {
  it("register → get / list で取り出せる", () => {
    const reg = createSessionRegistry();
    const conn = makeConn();
    reg.register(makeSession("s1"), conn);
    expect(reg.get("s1")?.session_id).toBe("s1");
    expect(reg.list().map((s) => s.session_id)).toEqual(["s1"]);
    expect(reg.get("nope")).toBeNull();
  });

  it("register は同じ session_id で conn を差し替える", () => {
    const reg = createSessionRegistry();
    const first = makeConn();
    const second = makeConn();
    reg.register(makeSession("s1"), first);
    reg.register(makeSession("s1"), second);
    reg.sendToSession("s1", { type: "reply", body: "hi" });
    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual([{ type: "reply", body: "hi" }]);
  });

  it("setStatus は更新後の session を返し、未知なら null", () => {
    const reg = createSessionRegistry();
    reg.register(makeSession("s1"), makeConn());
    const updated = reg.setStatus("s1", "awaiting");
    expect(updated?.status).toBe("awaiting");
    expect(reg.get("s1")?.status).toBe("awaiting");
    expect(reg.setStatus("nope", "ended")).toBeNull();
  });

  it("end は登録を消し、status:ended の session を返す", () => {
    const reg = createSessionRegistry();
    reg.register(makeSession("s1"), makeConn());
    const ended = reg.end("s1");
    expect(ended?.status).toBe("ended");
    expect(reg.get("s1")).toBeNull();
    expect(reg.end("s1")).toBeNull();
  });

  it("endByConn は conn に紐づく session を終了する", () => {
    const reg = createSessionRegistry();
    const conn = makeConn();
    reg.register(makeSession("s1"), conn);
    const ended = reg.endByConn(conn);
    expect(ended?.session_id).toBe("s1");
    expect(reg.get("s1")).toBeNull();
    expect(reg.endByConn(makeConn())).toBeNull();
  });

  it("trackRequest → takeRequest は 1 回限りで解決する", () => {
    const reg = createSessionRegistry();
    reg.register(makeSession("s1"), makeConn());
    reg.trackRequest(RID_A, "s1", "question");
    expect(reg.takeRequest(RID_A)).toEqual({ sessionId: "s1", kind: "question" });
    expect(reg.takeRequest(RID_A)).toBeNull();
    expect(reg.takeRequest(RID_B)).toBeNull();
  });

  it("end は紐づく request を破棄する (孤児回答を防ぐ)", () => {
    const reg = createSessionRegistry();
    reg.register(makeSession("s1"), makeConn());
    reg.trackRequest(RID_A, "s1", "plan");
    reg.end("s1");
    expect(reg.takeRequest(RID_A)).toBeNull();
  });

  it("sendToSession は開いた conn に送り true、閉/未知なら false", () => {
    const reg = createSessionRegistry();
    const conn = makeConn();
    reg.register(makeSession("s1"), conn);

    expect(reg.sendToSession("s1", { type: "reply", body: "go" })).toBe(true);
    expect(conn.sent).toEqual([{ type: "reply", body: "go" }]);

    conn.closed = true;
    expect(reg.sendToSession("s1", { type: "reply", body: "x" })).toBe(false);
    expect(reg.sendToSession("nope", { type: "reply", body: "x" })).toBe(false);
  });
});
