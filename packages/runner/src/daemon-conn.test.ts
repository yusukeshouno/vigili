import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionDaemonMessage,
  type SessionRunnerMessage,
  SessionRunnerMessageSchema,
} from "@vigili/shared";
import { afterEach, describe, expect, it } from "vitest";
import { connectDaemon } from "./daemon-conn.js";

/**
 * A minimal stand-in for the daemon's `kind:"session"` socket endpoint. It
 * accepts one runner connection, parses the newline-delimited runner messages
 * it receives, and lets the test push daemon replies back over the same socket.
 */
interface TestServer {
  readonly socketPath: string;
  readonly received: SessionRunnerMessage[];
  /** Resolve once at least `count` runner messages have been received. */
  waitFor(count: number): Promise<void>;
  /** Push a daemon → runner message over the live client socket. */
  send(msg: SessionDaemonMessage): void;
  /** Drop the client socket (simulates the daemon dying mid-flight). */
  dropClient(): void;
  close(): Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const socketPath = join(tmpdir(), `vigili-conn-${randomUUID()}.sock`);
  const received: SessionRunnerMessage[] = [];
  let client: Socket | null = null;
  let waiters: { count: number; resolve: () => void }[] = [];

  const checkWaiters = (): void => {
    waiters = waiters.filter((w) => {
      if (received.length >= w.count) {
        w.resolve();
        return false;
      }
      return true;
    });
  };

  const server: Server = createServer((sock) => {
    client = sock;
    sock.setEncoding("utf-8");
    let buffer = "";
    sock.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const parsed = SessionRunnerMessageSchema.safeParse(JSON.parse(line));
          if (parsed.success) {
            received.push(parsed.data);
            checkWaiters();
          }
        } catch {
          // ignore malformed lines in tests
        }
        nl = buffer.indexOf("\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  return {
    socketPath,
    received,
    waitFor(count) {
      return new Promise<void>((resolve) => {
        if (received.length >= count) {
          resolve();
          return;
        }
        waiters.push({ count, resolve });
      });
    },
    send(msg) {
      client?.write(`${JSON.stringify(msg)}\n`);
    },
    dropClient() {
      client?.destroy();
    },
    close() {
      return new Promise<void>((resolve) => {
        client?.destroy();
        server.close(() => {
          try {
            rmSync(socketPath);
          } catch {
            // socket already gone
          }
          resolve();
        });
      });
    },
  };
}

describe("daemon-conn", () => {
  let server: TestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("returns null when the socket does not exist", async () => {
    const conn = await connectDaemon(join(tmpdir(), `vigili-missing-${randomUUID()}.sock`), 200);
    expect(conn).toBeNull();
  });

  it("registers the session on start()", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    conn.start("my-tag", "/tmp/work");
    await server.waitFor(1);
    const msg = server.received[0];
    expect(msg?.type).toBe("session-start");
    if (msg?.type === "session-start") {
      expect(msg.tag).toBe("my-tag");
      expect(msg.cwd).toBe("/tmp/work");
      expect(msg.session_id).toBe(conn.sessionId);
    }
    conn.close();
  });

  it("requestPermission resolves with an allow decision", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const pending = conn.requestPermission("Bash", { command: "ls" });
    await server.waitFor(1);
    const msg = server.received[0];
    if (msg?.type !== "permission-request") {
      throw new Error("expected a permission-request");
    }
    expect(msg.tool_name).toBe("Bash");
    expect(msg.tool_input).toEqual({ command: "ls" });
    server.send({ type: "permission-decision", request_id: msg.request_id, decision: "allow" });
    expect(await pending).toEqual({ decision: "allow" });
    conn.close();
  });

  it("requestPermission carries the deny reason back", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const pending = conn.requestPermission("Bash", { command: "curl evil" });
    await server.waitFor(1);
    const msg = server.received[0];
    if (msg?.type !== "permission-request") {
      throw new Error("expected a permission-request");
    }
    server.send({
      type: "permission-decision",
      request_id: msg.request_id,
      decision: "deny",
      reason: "blocked by rule",
    });
    expect(await pending).toEqual({ decision: "deny", reason: "blocked by rule" });
    conn.close();
  });

  it("askQuestion resolves with the answers", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const pending = conn.askQuestion([
      {
        question: "Which?",
        header: "Pick",
        options: [{ label: "A", description: "" }],
        multiSelect: false,
      },
    ]);
    await server.waitFor(1);
    const msg = server.received[0];
    if (msg?.type !== "question") {
      throw new Error("expected a question");
    }
    server.send({ type: "answer", request_id: msg.request_id, answers: { Which: "A" } });
    expect(await pending).toEqual({ Which: "A" });
    conn.close();
  });

  it("requestPlan resolves with the plan decision", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const pending = conn.requestPlan("do the thing");
    await server.waitFor(1);
    const msg = server.received[0];
    if (msg?.type !== "plan") {
      throw new Error("expected a plan");
    }
    expect(msg.plan).toBe("do the thing");
    server.send({ type: "plan-decision", request_id: msg.request_id, decision: "approve" });
    expect(await pending).toEqual({ decision: "approve" });
    conn.close();
  });

  it("fires onReply for free-text reply messages", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const replies: string[] = [];
    conn.onReply((body) => replies.push(body));
    server.send({ type: "reply", body: "next turn please" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(replies).toEqual(["next turn please"]);
    conn.close();
  });

  it("fails every in-flight request safe when the socket drops", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    const perm = conn.requestPermission("Bash", { command: "ls" });
    const plan = conn.requestPlan("plan body");
    const question = conn.askQuestion([
      { question: "Q?", header: "", options: [], multiSelect: false },
    ]);
    await server.waitFor(3);
    server.dropClient();
    const [permOut, planOut, qOut] = await Promise.all([perm, plan, question]);
    expect(permOut).toEqual({ decision: "deny", reason: "daemon disconnected" });
    expect(planOut).toEqual({ decision: "reject", reason: "daemon disconnected" });
    expect(qOut).toBeNull();
    expect(conn.isClosed()).toBe(true);
  });

  it("resolves requests fail-safe immediately after close()", async () => {
    server = await startTestServer();
    const conn = await connectDaemon(server.socketPath);
    if (conn === null) {
      throw new Error("expected a connection");
    }
    conn.close();
    expect(conn.isClosed()).toBe(true);
    expect(await conn.requestPermission("Bash", {})).toEqual({
      decision: "deny",
      reason: "daemon disconnected",
    });
    expect(await conn.requestPlan("p")).toEqual({
      decision: "reject",
      reason: "daemon disconnected",
    });
    expect(await conn.askQuestion([])).toBeNull();
  });
});
