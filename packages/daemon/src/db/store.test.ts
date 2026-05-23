import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RequestStore, openStore } from "./store.js";

let store: RequestStore;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentinel-db-"));
  store = openStore(join(dir, "queue.db"));
});

afterEach(() => {
  store.close();
});

describe("RequestStore", () => {
  it("inserts and retrieves a pending request", () => {
    const id = randomUUID();
    store.insert({
      id,
      created_at: 1700000000000,
      session_id: "s",
      session_tag: "wiki",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
    });

    const got = store.get(id);
    expect(got).not.toBeNull();
    expect(got?.decision).toBeNull();
    expect(got?.tool_input).toEqual({ command: "ls" });
  });

  it("resolves a request", () => {
    const id = randomUUID();
    store.insert({
      id,
      created_at: 1700000000000,
      session_id: "s",
      session_tag: null,
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
    });

    store.resolve({
      id,
      resolved_at: 1700000001000,
      decision: "allow",
      decided_by: "rule:ls",
      reason: null,
    });

    const got = store.get(id);
    expect(got?.decision).toBe("allow");
    expect(got?.resolved_at).toBe(1700000001000);
  });

  it("listPending excludes resolved rows", () => {
    const a = randomUUID();
    const b = randomUUID();
    store.insert({
      id: a,
      created_at: 1,
      session_id: "s",
      session_tag: null,
      tool_name: "Bash",
      tool_input: {},
      cwd: "/",
    });
    store.insert({
      id: b,
      created_at: 2,
      session_id: "s",
      session_tag: null,
      tool_name: "Bash",
      tool_input: {},
      cwd: "/",
    });
    store.resolve({
      id: a,
      resolved_at: 3,
      decision: "allow",
      decided_by: "x",
      reason: null,
    });

    const pending = store.listPending();
    expect(pending.map((p) => p.id)).toEqual([b]);
  });

  it("listRecent returns rows newest first up to limit", () => {
    for (let i = 0; i < 5; i++) {
      store.insert({
        id: randomUUID(),
        created_at: 1000 + i,
        session_id: "s",
        session_tag: null,
        tool_name: "Bash",
        tool_input: {},
        cwd: "/",
      });
    }
    const recent = store.listRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.created_at).toBe(1004);
    expect(recent[1]?.created_at).toBe(1003);
    expect(recent[2]?.created_at).toBe(1002);
  });
});
