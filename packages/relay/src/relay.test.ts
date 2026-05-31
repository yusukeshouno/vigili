/**
 * Relay の REST + WSS を本物の Fastify インスタンスで起動して検証する。
 * DB は :memory: SQLite。port は 0 で OS 採番。
 */

import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { openRelayStore, type RelayStore } from "./db.js";
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

let relay: RunningRelay;
let store: RelayStore;
let base: string;

beforeEach(async () => {
  const port = await getFreePort();
  store = openRelayStore(":memory:");
  relay = await startRelay({
    port,
    host: "127.0.0.1",
    store,
    log: () => undefined,
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
  const res = await fetch(base + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

async function getJson(path: string, token?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

interface Account {
  token: string;
  email: string;
  account_id: string;
}

async function signup(email: string, password = "password1234"): Promise<Account> {
  const r = await postJson("/v1/signup", { email, password });
  expect(r.status).toBe(201);
  const j = r.json as { account: { id: string; email: string }; session: { token: string } };
  return { token: j.session.token, email: j.account.email, account_id: j.account.id };
}

interface Pairing {
  id: string;
  agent_key: string;
  user_token: string;
}

async function createPairing(token: string, name = "mac"): Promise<Pairing> {
  const r = await postJson("/v1/pairings", { name }, token);
  expect(r.status).toBe(201);
  return r.json as Pairing;
}

function connectWs(
  path: string,
  token: string,
): Promise<{
  ws: WebSocket;
  next: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${relay.port}${path}?token=${encodeURIComponent(token)}`,
    );
    const queue: string[] = [];
    const waiters: Array<(v: string) => void> = [];
    ws.on("message", (raw: Buffer) => {
      const msg = raw.toString("utf-8");
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    });
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), 1500);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({
        ws,
        next: () =>
          new Promise((res, rej) => {
            const q = queue.shift();
            if (q) return res(q);
            const t = setTimeout(() => rej(new Error("ws msg timeout")), 1500);
            waiters.push((m) => {
              clearTimeout(t);
              res(m);
            });
          }),
        close: () => ws.close(),
      });
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.once("close", (code) => {
      if (code !== 1000 && code !== 1005) {
        reject(new Error(`ws closed code=${code}`));
      }
    });
  });
}

describe("relay REST", () => {
  it("healthz returns ok", async () => {
    const r = await getJson("/healthz");
    expect(r.status).toBe(200);
    expect((r.json as { ok: boolean }).ok).toBe(true);
  });

  it("signup → signin → me round-trips", async () => {
    const acct = await signup("a@b.co");
    const me = await getJson("/v1/me", acct.token);
    expect(me.status).toBe(200);
    expect((me.json as { email: string }).email).toBe("a@b.co");
    const si = await postJson("/v1/signin", { email: "a@b.co", password: "password1234" });
    expect(si.status).toBe(200);
  });

  it("signup rejects duplicate email", async () => {
    await signup("dup@x.co");
    const r = await postJson("/v1/signup", { email: "dup@x.co", password: "password1234" });
    expect(r.status).toBe(409);
  });

  it("signin rejects wrong password", async () => {
    await signup("p@q.co");
    const r = await postJson("/v1/signin", { email: "p@q.co", password: "WRONG-WRONG" });
    expect(r.status).toBe(401);
  });

  it("/v1/me without auth returns 401", async () => {
    const r = await getJson("/v1/me");
    expect(r.status).toBe(401);
  });

  it("pairings create + list + delete", async () => {
    const acct = await signup("paired@x.co");
    const pair = await createPairing(acct.token, "macbook");
    const list = await getJson("/v1/pairings/me", acct.token);
    expect(list.status).toBe(200);
    const items = (list.json as { pairings: Array<{ id: string; name: string | null }> }).pairings;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(pair.id);
    expect(items[0]?.name).toBe("macbook");

    const res = await fetch(`${base}/v1/pairings/${pair.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${acct.token}` },
    });
    expect(res.status).toBe(204);
    const after = await getJson("/v1/pairings/me", acct.token);
    expect((after.json as { pairings: unknown[] }).pairings).toHaveLength(0);
  });

  it("cannot delete another account's pairing", async () => {
    const a = await signup("a-owner@x.co");
    const b = await signup("b-stranger@x.co");
    const pair = await createPairing(a.token);
    const res = await fetch(`${base}/v1/pairings/${pair.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.status).toBe(404);
  });

  it("devices register only for owned pairings", async () => {
    const a = await signup("dev-a@x.co");
    const b = await signup("dev-b@x.co");
    const pair = await createPairing(a.token);
    const okRes = await postJson(
      "/v1/devices",
      { pairing_id: pair.id, apns_token: "abc12345", platform: "ios" },
      a.token,
    );
    expect(okRes.status).toBe(201);
    const denied = await postJson(
      "/v1/devices",
      { pairing_id: pair.id, apns_token: "xyz98765", platform: "ios" },
      b.token,
    );
    expect(denied.status).toBe(404);
  });
});

describe("relay WSS", () => {
  it("rejects agent with wrong key", async () => {
    const acct = await signup("ws-a@x.co");
    const pair = await createPairing(acct.token);
    await expect(connectWs(`/v1/agents/${pair.id}`, "WRONG")).rejects.toBeDefined();
  });

  it("rejects client with wrong token", async () => {
    const acct = await signup("ws-c@x.co");
    const pair = await createPairing(acct.token);
    await expect(connectWs(`/v1/clients/${pair.id}`, "WRONG")).rejects.toBeDefined();
  });

  it("fan-out: agent message reaches all connected clients", async () => {
    const acct = await signup("fan@x.co");
    const pair = await createPairing(acct.token);
    const client1 = await connectWs(`/v1/clients/${pair.id}`, pair.user_token);
    const client2 = await connectWs(`/v1/clients/${pair.id}`, pair.user_token);
    // 接続直後に届く agent-status: false を 1 通読み捨て
    expect(JSON.parse(await client1.next())).toMatchObject({ type: "agent-status", online: false });
    expect(JSON.parse(await client2.next())).toMatchObject({ type: "agent-status", online: false });

    const agent = await connectWs(`/v1/agents/${pair.id}`, pair.agent_key);
    // agent 接続で各 client に online status 通知が飛ぶ
    expect(JSON.parse(await client1.next())).toMatchObject({ type: "agent-status", online: true });
    expect(JSON.parse(await client2.next())).toMatchObject({ type: "agent-status", online: true });

    // agent 側から送ったメッセージが全 client に届く
    agent.ws.send(JSON.stringify({ type: "pending", id: "x" }));
    expect(JSON.parse(await client1.next())).toMatchObject({ type: "pending", id: "x" });
    expect(JSON.parse(await client2.next())).toMatchObject({ type: "pending", id: "x" });

    client1.close();
    client2.close();
    agent.close();
  });

  it("client → agent message is forwarded", async () => {
    const acct = await signup("rev@x.co");
    const pair = await createPairing(acct.token);
    const agent = await connectWs(`/v1/agents/${pair.id}`, pair.agent_key);
    const client = await connectWs(`/v1/clients/${pair.id}`, pair.user_token);
    expect(JSON.parse(await client.next())).toMatchObject({ type: "agent-status", online: true });

    client.ws.send(JSON.stringify({ type: "decide", id: "y", decision: "allow" }));
    const got = JSON.parse(await agent.next());
    expect(got).toMatchObject({ type: "decide", id: "y" });
    client.close();
    agent.close();
  });
});
