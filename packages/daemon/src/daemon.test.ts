import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { type Socket, connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PolicyConfig, WsClientMessage, WsServerMessage } from "@vigili/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
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

/** OS から空きポートを 1 つ借りる (WS サーバを立てるテスト用)。 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close();
        reject(new Error("could not determine port"));
      }
    });
    srv.on("error", reject);
  });
}

interface WsClient {
  send(value: WsClientMessage): void;
  /** 指定 type の server メッセージが来るまで読み飛ばす (snapshot 等を skip)。 */
  waitForType<T extends WsServerMessage["type"]>(
    type: T,
  ): Promise<Extract<WsServerMessage, { type: T }>>;
  close(): void;
}

/** WS クライアントを 1 本繋ぐ (iOS/Mac/PWA 相当)。 */
function connectWs(port: number, token: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const queue: WsServerMessage[] = [];
    const waiters: Array<(v: WsServerMessage) => void> = [];

    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf-8")) as WsServerMessage;
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    });

    const nextMsg = (): Promise<WsServerMessage> => {
      const q = queue.shift();
      if (q) return Promise.resolve(q);
      return new Promise<WsServerMessage>((res, rej) => {
        const t = setTimeout(() => rej(new Error("test: WS message timeout")), 2000);
        waiters.push((m) => {
          clearTimeout(t);
          res(m);
        });
      });
    };

    const timer = setTimeout(() => reject(new Error("WS connect timeout")), 1000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({
        send(value) {
          ws.send(JSON.stringify(value));
        },
        async waitForType(type) {
          for (let i = 0; i < 20; i++) {
            const m = await nextMsg();
            if (m.type === type) {
              return m as Extract<WsServerMessage, { type: typeof type }>;
            }
          }
          throw new Error(`test: never saw WS message of type ${type}`);
        },
        close() {
          ws.close();
        },
      });
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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

describe("startDaemon — hosted sessions (L4)", () => {
  const SID = "sess-1";
  const cwd = "/tmp/proj";

  function startSession(conn: OpenConn): void {
    conn.send({ kind: "session", type: "session-start", session_id: SID, tag: "proj", cwd });
  }

  function requestPermission(conn: OpenConn, command: string): string {
    const request_id = randomUUID();
    conn.send({
      kind: "session",
      type: "permission-request",
      session_id: SID,
      request_id,
      tool_name: "Bash",
      tool_input: { command },
      cwd,
    });
    return request_id;
  }

  /** ask が queue に enroll されるまで pending を polling する (中間応答が無いため)。 */
  async function waitForPending(admin: OpenConn): Promise<AdminResponse & { action: "pending" }> {
    for (let i = 0; i < 50; i++) {
      admin.send({ kind: "admin", action: "pending" });
      const resp = (await admin.next()) as AdminResponse;
      if (resp.action === "pending" && resp.pending.length > 0) return resp;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("test: pending never appeared");
  }

  it("auto-allows a hosted permission via rule (reuses policy engine)", async () => {
    const runner = openConn();
    startSession(runner);
    const rid = requestPermission(runner, "ls");
    const resp = (await runner.next()) as {
      type: string;
      request_id: string;
      decision: string;
    };
    expect(resp).toMatchObject({
      type: "permission-decision",
      request_id: rid,
      decision: "allow",
    });
    runner.close();
  });

  it("auto-denies a hosted permission via rule", async () => {
    const runner = openConn();
    startSession(runner);
    const rid = requestPermission(runner, "curl evil");
    const resp = (await runner.next()) as {
      type: string;
      request_id: string;
      decision: string;
      reason?: string;
    };
    expect(resp).toMatchObject({
      type: "permission-decision",
      request_id: rid,
      decision: "deny",
      reason: "blocked by rule",
    });
    runner.close();
  });

  it("denies an invariant-blocked hosted permission unconditionally", async () => {
    const runner = openConn();
    startSession(runner);
    const rid = requestPermission(runner, "rm -rf /");
    const resp = (await runner.next()) as { type: string; request_id: string; decision: string };
    expect(resp).toMatchObject({
      type: "permission-decision",
      request_id: rid,
      decision: "deny",
    });
    runner.close();
  });

  it("ask-tier hosted permission resolves via admin approve", async () => {
    const runner = openConn();
    startSession(runner);
    const rid = requestPermission(runner, "echo unknown");

    // 中間応答は無いので pending を polling して ApprovalRequest id を得る。
    const admin = openConn();
    const pendingResp = await waitForPending(admin);
    expect(pendingResp.pending).toHaveLength(1);
    expect(pendingResp.pending[0]?.session_id).toBe(SID);
    expect(pendingResp.pending[0]?.session_tag).toBe("proj");
    const approvalId = pendingResp.pending[0]?.id ?? "";

    admin.send({
      kind: "admin",
      action: "resolve",
      id: approvalId,
      decision: "allow",
      reason: "ok",
    });
    await admin.next();
    admin.close();

    const resp = (await runner.next()) as {
      type: string;
      request_id: string;
      decision: string;
      reason?: string;
    };
    expect(resp).toMatchObject({
      type: "permission-decision",
      request_id: rid,
      decision: "allow",
      reason: "ok",
    });
    runner.close();
  });

  it("rejects a malformed session message with session-error", async () => {
    const runner = openConn();
    runner.send({ kind: "session", type: "bogus-type" });
    const resp = (await runner.next()) as { type: string; error: string };
    expect(resp.type).toBe("session-error");
    expect(resp.error).toContain("invalid session message");
    runner.close();
  });
});

describe("startDaemon — hosted session questions (L4, WS round-trip)", () => {
  const SID = "sess-q";
  const cwd = "/tmp/proj";

  it("fans a question out to WS clients and routes the answer back to the runner", async () => {
    // 既定の daemon は enableWs:false なので、WS 有効で立て直す。
    await daemon.close();
    const wsPort = await getFreePort();
    daemon = await startDaemon({
      home,
      policy: allowDenyPolicy,
      log: () => undefined,
      enableWs: true,
      wsPort,
      wsHost: "127.0.0.1",
    });

    // iOS / Mac 相当の WS クライアントを 2 本繋ぐ (単一キューへの fan-out を確認)。
    const phone = await connectWs(wsPort, daemon.token);
    const desktop = await connectWs(wsPort, daemon.token);

    // runner (vigili run 相当) が session を開始し、AskUserQuestion を投げる。
    const runner = openConn();
    runner.send({ kind: "session", type: "session-start", session_id: SID, tag: "proj", cwd });

    const requestId = randomUUID();
    runner.send({
      kind: "session",
      type: "question",
      session_id: SID,
      request_id: requestId,
      questions: [
        {
          question: "Which database?",
          header: "DB",
          options: [
            { label: "Postgres", description: "relational" },
            { label: "SQLite", description: "embedded" },
          ],
          multiSelect: false,
        },
      ],
    });

    // 両クライアントに同じ question が届く (snapshot / session-started は読み飛ばす)。
    const q1 = await phone.waitForType("question");
    const q2 = await desktop.waitForType("question");
    for (const q of [q1, q2]) {
      expect(q.session_id).toBe(SID);
      expect(q.request_id).toBe(requestId);
      expect(q.questions).toHaveLength(1);
      expect(q.questions[0]?.question).toBe("Which database?");
      expect(q.questions[0]?.options.map((o) => o.label)).toEqual(["Postgres", "SQLite"]);
    }

    // phone から回答すると、runner にだけ answer が返る。
    phone.send({
      type: "answer-question",
      request_id: requestId,
      answers: { "Which database?": "SQLite" },
    });

    const answer = (await runner.next()) as {
      type: string;
      request_id: string;
      answers: Record<string, string>;
    };
    expect(answer).toEqual({
      type: "answer",
      request_id: requestId,
      answers: { "Which database?": "SQLite" },
    });

    phone.close();
    desktop.close();
    runner.close();
  });
});

describe("startDaemon — bootstrap", () => {
  it("writes the default policy.yaml when one doesn't exist", async () => {
    // 通常の beforeEach は empty policy.yaml を書いているので一度 close。
    await daemon.close();

    // 別の home (policy.yaml 不在) を準備して、明示的な policy を渡さない。
    const freshHome = mkdtempSync(join(tmpdir(), "vigili-bootstrap-"));
    const freshPolicyPath = join(freshHome, "policy.yaml");
    expect(existsSync(freshPolicyPath)).toBe(false);

    const fresh = await startDaemon({
      home: freshHome,
      log: () => undefined,
      enableWs: false,
    });
    try {
      expect(existsSync(freshPolicyPath)).toBe(true);
      const written = readFileSync(freshPolicyPath, "utf-8");
      // 個人プロジェクト名が紛れないことを保証する。
      expect(written).not.toContain("neort-wiki");
      expect(written).not.toContain("diptych");
      // 初回は素のテンプレート: defaults だけで rules は空。
      // ユーザーは Mac アプリのウィザードでルールを追加する。
      expect(written).toContain("defaults:");
      expect(written).toContain("unknown: ask");
      expect(written).toMatch(/rules:\s*\[\]/);
    } finally {
      await fresh.close();
    }
  });
});

describe("startDaemon — relay-configure (Sign in with Apple ホット再接続)", () => {
  it("persists the relay section to config.yaml and reports ok", async () => {
    // 起動時 relay 無し。relay-configure admin で cold から接続を構成する。
    const resp = (await oneShot({
      kind: "admin",
      action: "relay-configure",
      url: "wss://127.0.0.1:1", // 接続は失敗してよい (config 永続化と admin 応答を確認する)
      pairing_id: "pid-test-1234",
      agent_key: "agentkey-test",
    })) as AdminResponse & { action: "relay-configure" };

    expect(resp.kind).toBe("admin");
    expect(resp.action).toBe("relay-configure");
    expect(resp.ok).toBe(true);
    // 接続確立は非同期 (死んだポート) なので connected は false で問題ない。
    expect(typeof resp.connected).toBe("boolean");

    // config.yaml に relay セクションが書かれている (daemon が唯一の writer)。
    const cfg = readFileSync(join(home, "config.yaml"), "utf-8");
    expect(cfg).toContain("relay:");
    expect(cfg).toContain("pid-test-1234");
    expect(cfg).toContain("wss://127.0.0.1:1");
  });

  it("is idempotent across repeated configures (latest endpoint wins)", async () => {
    await oneShot({
      kind: "admin",
      action: "relay-configure",
      url: "wss://127.0.0.1:1",
      pairing_id: "pid-first",
      agent_key: "k1",
    });
    const resp = (await oneShot({
      kind: "admin",
      action: "relay-configure",
      url: "wss://127.0.0.1:2",
      pairing_id: "pid-second",
      agent_key: "k2",
    })) as AdminResponse & { action: "relay-configure" };
    expect(resp.ok).toBe(true);

    const cfg = readFileSync(join(home, "config.yaml"), "utf-8");
    expect(cfg).toContain("pid-second");
    expect(cfg).not.toContain("pid-first");
  });
});
