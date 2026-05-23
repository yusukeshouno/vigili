import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createMessageStore } from "./messages.js";

function openInMemory() {
  const db = new Database(":memory:");
  return { db, store: createMessageStore(db) };
}

describe("createMessageStore", () => {
  it("inserts and lists recent", () => {
    const { store } = openInMemory();
    const m = store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      session_id: "sess-a",
      body: "hello",
      created_at: 100,
    });
    expect(m.delivered_at).toBeNull();
    expect(store.listRecent(10)).toHaveLength(1);
  });

  it("drainForSession returns FIFO and marks delivered", () => {
    const { store } = openInMemory();
    store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      session_id: "sess-a",
      body: "first",
      created_at: 100,
    });
    store.insert({
      id: "00000000-0000-4000-8000-000000000002",
      session_id: "sess-a",
      body: "second",
      created_at: 200,
    });
    const drained = store.drainForSession("sess-a", 500);
    expect(drained).toHaveLength(2);
    expect(drained[0]?.body).toBe("first");
    expect(drained[1]?.body).toBe("second");
    expect(drained[0]?.delivered_at).toBe(500);
    expect(drained[1]?.delivered_at).toBe(500);
    // 2 回目は空
    expect(store.drainForSession("sess-a", 600)).toEqual([]);
  });

  it("drainForSession isolates by session_id", () => {
    const { store } = openInMemory();
    store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      session_id: "sess-a",
      body: "for a",
      created_at: 100,
    });
    store.insert({
      id: "00000000-0000-4000-8000-000000000002",
      session_id: "sess-b",
      body: "for b",
      created_at: 100,
    });
    expect(store.drainForSession("sess-a", 1).map((m) => m.body)).toEqual(["for a"]);
    // sess-b は残っている
    expect(store.listUndelivered().map((m) => m.body)).toEqual(["for b"]);
  });

  it("listUndelivered excludes drained", () => {
    const { store } = openInMemory();
    store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      session_id: "sess-a",
      body: "x",
      created_at: 100,
    });
    expect(store.listUndelivered()).toHaveLength(1);
    store.drainForSession("sess-a", 200);
    expect(store.listUndelivered()).toHaveLength(0);
  });
});
