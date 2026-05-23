import { createServer } from "node:net";
import type { WsClientMessage, WsServerMessage } from "@sentinel/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type PendingQueue, createPendingQueue } from "../queue.js";
import { type RunningWsServer, startWsServer } from "./ws.js";

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

const ID_A = "00000000-0000-4000-8000-000000000010";

let queue: PendingQueue;
let server: RunningWsServer;
let port: number;
const TOKEN = "test-token-1234567890abcdef";

beforeEach(async () => {
  queue = createPendingQueue();
  port = await getFreePort();
  server = await startWsServer({
    port,
    host: "127.0.0.1",
    token: TOKEN,
    queue,
    log: () => undefined,
  });
});

afterEach(async () => {
  await server.close();
});

interface Client {
  ws: WebSocket;
  next(): Promise<WsServerMessage>;
  close(): void;
}

function connect(token = TOKEN): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const queue: WsServerMessage[] = [];
    const waiters: Array<(v: WsServerMessage) => void> = [];

    // 接続直後に snapshot が送られて来るので、open 前から message listener を貼る。
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf-8")) as WsServerMessage;
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    });

    const timer = setTimeout(() => reject(new Error("WS connect timeout")), 1000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({
        ws,
        next() {
          const q = queue.shift();
          if (q) return Promise.resolve(q);
          return new Promise<WsServerMessage>((res, rej) => {
            const t = setTimeout(() => rej(new Error("WS message timeout")), 1000);
            waiters.push((m) => {
              clearTimeout(t);
              res(m);
            });
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.once("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`WS closed with code ${code}`));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("WS server", () => {
  it("rejects connection with wrong token", async () => {
    await expect(connect("WRONG")).rejects.toBeDefined();
  });

  it("sends snapshot on connect", async () => {
    const c = await connect();
    const msg = await c.next();
    expect(msg.type).toBe("snapshot");
    if (msg.type === "snapshot") expect(msg.pending).toEqual([]);
    c.close();
  });

  it("broadcasts pending on new ask", async () => {
    const c = await connect();
    await c.next(); // snapshot
    void queue.enroll(makeReq(ID_A), 10_000);
    const msg = await c.next();
    expect(msg.type).toBe("pending");
    if (msg.type === "pending") expect(msg.request.id).toBe(ID_A);
    c.close();
  });

  it("broadcasts resolved on resolve", async () => {
    const enrolled = queue.enroll(makeReq(ID_A), 10_000);
    const c = await connect();
    const snap = await c.next();
    expect(snap.type).toBe("snapshot");

    queue.resolve(ID_A, "allow", "human:test", null);
    await enrolled;
    const msg = await c.next();
    expect(msg.type).toBe("resolved");
    if (msg.type === "resolved") {
      expect(msg.id).toBe(ID_A);
      expect(msg.decision).toBe("allow");
    }
    c.close();
  });

  it("client decide resolves the request", async () => {
    const enrolled = queue.enroll(makeReq(ID_A), 10_000);
    const c = await connect();
    await c.next(); // snapshot
    const msg: WsClientMessage = { type: "decide", id: ID_A, decision: "deny" };
    c.ws.send(JSON.stringify(msg));
    const r = await enrolled;
    expect(r.decision).toBe("deny");
    expect(r.source).toBe("human:ws");
    c.close();
  });
});

function makeReq(id: string) {
  return {
    id,
    created_at: Date.now(),
    resolved_at: null,
    session_id: "s",
    session_tag: null,
    tool_name: "Bash",
    tool_input: { command: "x" },
    cwd: "/tmp",
    decision: null,
    decided_by: null,
    reason: null,
  };
}
