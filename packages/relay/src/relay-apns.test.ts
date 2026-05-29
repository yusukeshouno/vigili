/**
 * user_token 認証の device 登録エンドポイントと、agent の `pending` を受けたときの
 * APNs push トリガを、本物の Fastify + :memory: SQLite で検証する。
 *
 * 実際の Apple への送信はせず、fake ApnsSender を inject して send() 呼び出しを観測する。
 */

import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ApnsNotification, ApnsSender } from "./apns.js";
import { type RelayStore, openRelayStore } from "./db.js";
import { type RunningRelay, startRelay } from "./index.js";

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
        reject(new Error("no port"));
      }
    });
    srv.on("error", reject);
  });
}

interface SentPush {
  token: string;
  note: ApnsNotification;
}

let relay: RunningRelay;
let store: RelayStore;
let base: string;
let sent: SentPush[];
let nextUnregistered: boolean;

beforeEach(async () => {
  const port = await getFreePort();
  store = openRelayStore(":memory:");
  sent = [];
  nextUnregistered = false;
  const fakeApns: ApnsSender = {
    enabled: true,
    async send(token, note) {
      sent.push({ token, note });
      return {
        token,
        status: nextUnregistered ? 410 : 200,
        unregistered: nextUnregistered,
      };
    },
    close() {
      /* no-op */
    },
  };
  relay = await startRelay({
    port,
    host: "127.0.0.1",
    store,
    log: () => undefined,
    apns: fakeApns,
  });
  base = `http://127.0.0.1:${relay.port}`;
});

afterEach(async () => {
  await relay.close();
  store.close();
});

async function postJson(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

interface Pairing {
  id: string;
  agent_key: string;
  user_token: string;
}

async function makePairing(email: string): Promise<Pairing> {
  const su = await postJson("/v1/signup", { email, password: "password1234" });
  const acct = su.json as { session: { token: string } };
  const cp = await postJson("/v1/pairings", { name: "mac" }, acct.session.token);
  return cp.json as Pairing;
}

function connectAgent(port: number, pid: string, key: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/v1/agents/${pid}?token=${encodeURIComponent(key)}`,
    );
    const timer = setTimeout(() => reject(new Error("agent connect timeout")), 1500);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("client device registration (user_token)", () => {
  it("registers a device with the user_token", async () => {
    const pair = await makePairing("dreg@x.co");
    const r = await postJson(
      `/v1/clients/${pair.id}/devices`,
      { apns_token: "devicetoken123", platform: "ios" },
      pair.user_token,
    );
    expect(r.status).toBe(201);
    expect(store.listDevicesForPairing(pair.id)).toHaveLength(1);
  });

  it("rejects a wrong user_token", async () => {
    const pair = await makePairing("dreg2@x.co");
    const r = await postJson(
      `/v1/clients/${pair.id}/devices`,
      { apns_token: "x12345678", platform: "ios" },
      "WRONG-TOKEN",
    );
    expect(r.status).toBe(401);
  });

  it("rejects an unknown pairing", async () => {
    const pair = await makePairing("dreg3@x.co");
    const r = await postJson(
      "/v1/clients/00000000-0000-0000-0000-000000000000/devices",
      { apns_token: "x12345678", platform: "ios" },
      pair.user_token,
    );
    expect(r.status).toBe(404);
  });
});

describe("APNs push on pending", () => {
  it("pushes to registered devices when agent sends a pending", async () => {
    const pair = await makePairing("push@x.co");
    await postJson(
      `/v1/clients/${pair.id}/devices`,
      { apns_token: "devicetoken123", platform: "ios" },
      pair.user_token,
    );
    const agent = await connectAgent(relay.port, pair.id, pair.agent_key);
    agent.send(
      JSON.stringify({ type: "pending", request: { tool_name: "Bash", session_tag: "neort" } }),
    );

    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.token).toBe("devicetoken123");
    expect(sent[0]?.note.title).toContain("neort");
    expect(sent[0]?.note.body).toContain("Bash");
    agent.close();
  });

  it("does not push for non-pending agent messages", async () => {
    const pair = await makePairing("nopush@x.co");
    await postJson(
      `/v1/clients/${pair.id}/devices`,
      { apns_token: "devicetoken123", platform: "ios" },
      pair.user_token,
    );
    const agent = await connectAgent(relay.port, pair.id, pair.agent_key);
    agent.send(JSON.stringify({ type: "resolved", id: "abc" }));

    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(0);
    agent.close();
  });

  it("removes a device whose token is unregistered (410)", async () => {
    const pair = await makePairing("dead@x.co");
    await postJson(
      `/v1/clients/${pair.id}/devices`,
      { apns_token: "deadtoken123", platform: "ios" },
      pair.user_token,
    );
    nextUnregistered = true;
    const agent = await connectAgent(relay.port, pair.id, pair.agent_key);
    agent.send(JSON.stringify({ type: "pending", request: { tool_name: "Write" } }));

    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(1);
    expect(store.listDevicesForPairing(pair.id)).toHaveLength(0);
    agent.close();
  });
});
