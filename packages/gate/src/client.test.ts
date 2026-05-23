import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { type Server, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GateConnectionError, sendToDaemon } from "./client.js";

let server: Server | null = null;
let socketPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-gate-client-"));
  socketPath = join(dir, "daemon.sock");
});

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve();
      const s = server;
      server = null;
      s.close(() => {
        if (existsSync(socketPath)) {
          try {
            unlinkSync(socketPath);
          } catch {
            // ignore
          }
        }
        resolve();
      });
    }),
);

function mockDaemon(handler: (req: unknown) => unknown | Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((conn) => {
      let buf = "";
      conn.setEncoding("utf-8");
      conn.on("data", (chunk: string | Buffer) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          void Promise.resolve(handler(JSON.parse(line))).then((reply) => {
            if (reply !== undefined) conn.write(`${JSON.stringify(reply)}\n`);
          });
        }
      });
    });
    server.listen(socketPath, () => resolve());
  });
}

const baseReq = {
  tool_name: "Bash",
  tool_input: { command: "ls" },
  cwd: "/tmp",
  session_id: "s",
};

describe("sendToDaemon", () => {
  it("returns allow", async () => {
    await mockDaemon(() => ({ decision: "allow" }));
    const r = await sendToDaemon(baseReq, { socketPath });
    expect(r).toEqual({ decision: "allow" });
  });

  it("returns deny with reason", async () => {
    await mockDaemon(() => ({ decision: "deny", reason: "blocked" }));
    const r = await sendToDaemon(baseReq, { socketPath });
    expect(r).toEqual({ decision: "deny", reason: "blocked" });
  });

  it("times out when daemon does not respond", async () => {
    await mockDaemon(() => undefined); // never reply
    await expect(sendToDaemon(baseReq, { socketPath, askTimeoutMs: 80 })).rejects.toBeInstanceOf(
      GateConnectionError,
    );
  });

  it("fails fast when socket does not exist", async () => {
    await expect(
      sendToDaemon(baseReq, { socketPath: "/nonexistent/sentinel.sock", connectTimeoutMs: 80 }),
    ).rejects.toBeInstanceOf(GateConnectionError);
  });

  it("rejects malformed response", async () => {
    await mockDaemon(() => ({ decision: "maybe" }));
    await expect(sendToDaemon(baseReq, { socketPath })).rejects.toBeInstanceOf(GateConnectionError);
  });

  it("waits for ask resolution on the same connection", async () => {
    const ID = "00000000-0000-4000-8000-000000000000";
    server = createServer((conn) => {
      let buf = "";
      conn.setEncoding("utf-8");
      conn.on("data", (chunk: string | Buffer) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          buf = buf.slice(nl + 1);
          conn.write(`${JSON.stringify({ decision: "ask", request_id: ID })}\n`);
          setTimeout(() => {
            conn.write(`${JSON.stringify({ request_id: ID, decision: "allow" })}\n`);
          }, 30);
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(socketPath, () => resolve()));

    const r = await sendToDaemon(baseReq, { socketPath, askTimeoutMs: 500 });
    expect(r).toEqual({ decision: "allow" });
  });
});
