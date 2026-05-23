import { mkdtempSync, writeFileSync } from "node:fs";
import { type Socket, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PolicyConfig } from "@vigili/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningDaemon, startDaemon } from "./daemon.js";
import type { Notifier, NotifyInput } from "./notify/ntfy.js";
import { paths } from "./paths.js";
import type { AdminResponse } from "./server/admin.js";

let home: string;
let daemon: RunningDaemon;

const allowDenyPolicy: PolicyConfig = {
  defaults: { unknown: "ask", timeout_seconds: 300 },
  rules: [
    {
      name: "read-only bash",
      when: { tool: "Bash", command_matches: "^(ls|cat|pwd)\\b" },
      action: "allow",
    },
    {
      name: "explicit deny",
      when: { tool: "Bash", command_matches: "^curl evil" },
      action: "deny",
      reason: "blocked by rule",
    },
  ],
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "sentinel-daemon-"));
  writeFileSync(join(home, "policy.yaml"), "", "utf-8");
  daemon = await startDaemon({
    home,
    policy: allowDenyPolicy,
    log: () => undefined,
    enableWs: false,
  });
});

afterEach(async () => {
  await daemon.close();
});

interface OpenConn {
  send(value: unknown): void;
  next(): Promise<unknown>;
  close(): void;
}

function openConn(): OpenConn {
  const p = paths(home);
  const conn: Socket = connect(p.socket);
  let buf = "";
  const queue: unknown[] = [];
  const waiters: Array<(v: unknown) => void> = [];

  conn.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf-8");
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const value: unknown = JSON.parse(line);
      const w = waiters.shift();
      if (w) w(value);
      else queue.push(value);
      nl = buf.indexOf("\n");
    }
  });
  conn.on("error", () => {
    // テストで接続切れた場合は無視。
  });

  return {
    send(value) {
      conn.write(`${JSON.stringify(value)}\n`);
    },
    next() {
      const v = queue.shift();
      if (v !== undefined) return Promise.resolve(v);
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("test: next() timeout")), 2000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    close() {
      conn.destroy();
    },
  };
}

async function oneShot(req: unknown): Promise<unknown> {
  const c = openConn();
  c.send(req);
  const r = await c.next();
  c.close();
  return r;
}

describe("startDaemon — immediate decisions", () => {
  it("returns allow for matching rule", async () => {
    const res = await oneShot({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      session_id: "s",
    });
    expect(res).toEqual({ decision: "allow" });
  });

  it("returns deny with reason from rule", async () => {
    const res = await oneShot({
      tool_name: "Bash",
      tool_input: { command: "curl evil" },
      cwd: "/tmp",
      session_id: "s",
    });
    expect(res).toMatchObject({ decision: "deny", reason: "blocked by rule" });
  });

  it("returns deny for invariant-blocked command", async () => {
    const res = await oneShot({
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
      cwd: "/tmp",
      session_id: "s",
    });
    expect(res).toMatchObject({ decision: "deny" });
  });

  it("rejects malformed input with deny", async () => {
    const res = await oneShot({ garbage: true });
    expect(res).toMatchObject({ decision: "deny" });
  });
});

describe("startDaemon — ask flow", () => {
  it("ask is resolved via admin approve on same gate connection", async () => {
    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "echo unknown" },
      cwd: "/tmp",
      session_id: "s",
    });
    const firstUnknown = await gate.next();
    const first = firstUnknown as { decision: string; request_id?: string };
    expect(first.decision).toBe("ask");
    expect(first.request_id).toBeDefined();
    const id = first.request_id as string;

    // 別接続で admin approve
    const admin = openConn();
    admin.send({ kind: "admin", action: "resolve", id, decision: "allow", reason: "ok" });
    const adminResp = (await admin.next()) as AdminResponse;
    expect(adminResp).toMatchObject({ kind: "admin", action: "resolve", ok: true });
    admin.close();

    // gate に resolution が届くはず
    const resolution = (await gate.next()) as {
      request_id: string;
      decision: string;
      reason?: string;
    };
    expect(resolution.request_id).toBe(id);
    expect(resolution.decision).toBe("allow");
    expect(resolution.reason).toBe("ok");
    gate.close();
  });

  it("ask resolves to deny via admin deny", async () => {
    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "echo unknown" },
      cwd: "/tmp",
      session_id: "s",
    });
    const first = (await gate.next()) as { decision: string; request_id: string };
    expect(first.decision).toBe("ask");

    const admin = openConn();
    admin.send({
      kind: "admin",
      action: "resolve",
      id: first.request_id,
      decision: "deny",
      reason: "no",
    });
    await admin.next();
    admin.close();

    const resolution = (await gate.next()) as { decision: string };
    expect(resolution.decision).toBe("deny");
    gate.close();
  });

  it("ask times out to deny", async () => {
    // 短いタイムアウト用に daemon を再起動
    await daemon.close();
    const policy: PolicyConfig = {
      defaults: { unknown: "ask", timeout_seconds: 1 },
      rules: [],
    };
    daemon = await startDaemon({ home, policy, log: () => undefined, enableWs: false });

    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "anything" },
      cwd: "/tmp",
      session_id: "s",
    });
    const first = (await gate.next()) as { decision: string };
    expect(first.decision).toBe("ask");
    const resolution = (await gate.next()) as { decision: string; reason?: string };
    expect(resolution.decision).toBe("deny");
    expect(resolution.reason).toMatch(/タイムアウト/u);
    gate.close();
  });

  it("admin pending lists current ask requests", async () => {
    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "echo a" },
      cwd: "/tmp",
      session_id: "s",
    });
    await gate.next(); // ask

    const admin = openConn();
    admin.send({ kind: "admin", action: "pending" });
    const resp = (await admin.next()) as AdminResponse;
    expect(resp.action).toBe("pending");
    if (resp.action === "pending") {
      expect(resp.pending).toHaveLength(1);
      expect(resp.pending[0]?.tool_input).toMatchObject({ command: "echo a" });
    }
    admin.close();
    gate.close();
  });

  it("admin stats returns today's bucket aggregation", async () => {
    // 1 件 allow (rule)、1 件 deny (rule) を素直に登録するだけのテスト。
    // policy 上 "echo " は read-only bash で allow される (test の defaultPolicy
    // で echo が allow ルールに入っている前提)。
    const gate1 = openConn();
    gate1.send({
      tool_name: "Bash",
      tool_input: { command: "ls /tmp" },
      cwd: "/tmp",
      session_id: "s",
    });
    await gate1.next();
    gate1.close();

    const admin = openConn();
    admin.send({ kind: "admin", action: "stats" });
    const resp = (await admin.next()) as AdminResponse;
    expect(resp.action).toBe("stats");
    if (resp.action === "stats") {
      expect(resp.ok).toBe(true);
      // 当日範囲なので少なくとも今投入した 1 件は含まれる
      expect(resp.stats.total).toBeGreaterThanOrEqual(1);
      expect(resp.stats.by_decision.allow + resp.stats.by_decision.deny).toBeGreaterThanOrEqual(1);
    }
    admin.close();
  });

  it("admin stats accepts explicit from_ms/to_ms range", async () => {
    const admin = openConn();
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    admin.send({
      kind: "admin",
      action: "stats",
      from_ms: farFuture,
      to_ms: farFuture + 1000,
    });
    const resp = (await admin.next()) as AdminResponse;
    expect(resp.action).toBe("stats");
    if (resp.action === "stats") {
      // 未来の窓なので 0 件
      expect(resp.stats.total).toBe(0);
    }
    admin.close();
  });

  it("admin resolve on unknown id returns ok=false", async () => {
    const admin = openConn();
    admin.send({
      kind: "admin",
      action: "resolve",
      id: "00000000-0000-4000-8000-000000000000",
      decision: "allow",
    });
    const resp = (await admin.next()) as AdminResponse;
    expect(resp).toMatchObject({ kind: "admin", action: "resolve", ok: false });
    admin.close();
  });

  it("gate disconnect cancels pending ask", async () => {
    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "echo b" },
      cwd: "/tmp",
      session_id: "s",
    });
    await gate.next(); // ask

    expect(daemon.queue.list()).toHaveLength(1);
    gate.close();

    // queue から消えるまで少し待つ
    await new Promise((r) => setTimeout(r, 50));
    expect(daemon.queue.list()).toHaveLength(0);
  });
});

describe("startDaemon — notifications", () => {
  it("fires notifier on ask with rule's notify level", async () => {
    await daemon.close();
    const notified: NotifyInput[] = [];
    const notifier: Notifier = {
      async notify(input) {
        notified.push(input);
      },
    };
    const policy: PolicyConfig = {
      defaults: { unknown: "ask", timeout_seconds: 60 },
      rules: [
        {
          name: "critical edit",
          when: { tool: "Edit", path_matches: "\\.env$" },
          action: "ask",
          notify: "critical",
        },
      ],
    };
    daemon = await startDaemon({
      home,
      policy,
      log: () => undefined,
      enableWs: false,
      notifier,
    });

    const gate = openConn();
    gate.send({
      tool_name: "Edit",
      tool_input: { file_path: ".env", old_string: "x", new_string: "y" },
      cwd: "/tmp",
      session_id: "s",
    });
    await gate.next(); // ask

    // notifier は ask 直後に発火するはず (resolve を待たない)
    await new Promise((r) => setTimeout(r, 20));
    expect(notified).toHaveLength(1);
    expect(notified[0]?.level).toBe("critical");
    expect(notified[0]?.ruleSource).toContain("critical edit");
    gate.close();
  });

  it("does not notify for allow/deny", async () => {
    await daemon.close();
    const notified: NotifyInput[] = [];
    const notifier: Notifier = {
      async notify(input) {
        notified.push(input);
      },
    };
    daemon = await startDaemon({
      home,
      policy: allowDenyPolicy,
      log: () => undefined,
      enableWs: false,
      notifier,
    });
    await oneShot({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      session_id: "s",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(notified).toHaveLength(0);
  });

  it("defaults notify level to normal when rule omits it", async () => {
    await daemon.close();
    const notified: NotifyInput[] = [];
    const notifier: Notifier = {
      async notify(input) {
        notified.push(input);
      },
    };
    const policy: PolicyConfig = {
      defaults: { unknown: "ask", timeout_seconds: 60 },
      rules: [],
    };
    daemon = await startDaemon({
      home,
      policy,
      log: () => undefined,
      enableWs: false,
      notifier,
    });
    const gate = openConn();
    gate.send({
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      cwd: "/tmp",
      session_id: "s",
    });
    await gate.next();
    await new Promise((r) => setTimeout(r, 20));
    expect(notified[0]?.level).toBe("normal");
    gate.close();
  });
});

describe("startDaemon — audit log", () => {
  it("records all requests with decision attribution", async () => {
    await oneShot({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      session_id: "session-a",
    });
    await oneShot({
      tool_name: "Bash",
      tool_input: { command: "curl evil" },
      cwd: "/tmp",
      session_id: "session-b",
    });
    const rows = daemon.store.listRecent(10);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const decisions = rows.map((r) => r.decision);
    expect(decisions).toContain("allow");
    expect(decisions).toContain("deny");
    const decidedBy = rows.map((r) => r.decided_by);
    expect(decidedBy.some((d) => d?.startsWith("rule:") ?? false)).toBe(true);
  });
});
