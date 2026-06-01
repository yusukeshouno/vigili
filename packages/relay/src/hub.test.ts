import { describe, expect, it } from "vitest";
import { type HubSocket, createPairingHub } from "./hub.js";

class FakeSocket implements HubSocket {
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

const ACC = "acc-1";

describe("PairingHub", () => {
  it("fan-out from agent to multiple clients", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const c1 = new FakeSocket();
    const c2 = new FakeSocket();
    hub.attachAgent("pid", agent, ACC);
    hub.attachClient("pid", c1);
    hub.attachClient("pid", c2);
    hub.forwardAgentToClients("pid", "hello");
    expect(c1.sent.at(-1)).toBe("hello");
    expect(c2.sent.at(-1)).toBe("hello");
    expect(agent.sent).toEqual([]);
  });

  it("client → agent forwarding", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const c1 = new FakeSocket();
    hub.attachAgent("pid", agent, ACC);
    hub.attachClient("pid", c1);
    hub.forwardClientToAgent("pid", "decide");
    expect(agent.sent.at(-1)).toBe("decide");
  });

  it("clients receive agent-status on attach and on agent detach", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const client = new FakeSocket();
    const { detach: detachAgent } = hub.attachAgent("pid", agent, ACC);
    hub.attachClient("pid", client);
    // attach 直後に status:online が 1 通流れる
    expect(client.sent[0]).toBe(JSON.stringify({ type: "agent-status", online: true }));
    detachAgent();
    expect(client.sent.at(-1)).toBe(JSON.stringify({ type: "agent-status", online: false }));
  });

  it("replaces existing agent on reconnect (closes old)", () => {
    const hub = createPairingHub();
    const oldAgent = new FakeSocket();
    const newAgent = new FakeSocket();
    hub.attachAgent("pid", oldAgent, ACC);
    hub.attachAgent("pid", newAgent, ACC);
    expect(oldAgent.closed).toBe(true);
    expect(hub.isAgentOnline("pid")).toBe(true);
  });

  it("cleans up pairing when no agent and no clients remain", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const client = new FakeSocket();
    const a = hub.attachAgent("pid", agent, ACC);
    const c = hub.attachClient("pid", client);
    expect(hub.size()).toBe(1);
    a.detach();
    c.detach();
    expect(hub.size()).toBe(0);
  });

  // ---------- account-centric fan-out ----------

  it("agent message reaches BOTH legacy pairing clients and account-stream clients", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const legacy = new FakeSocket();
    const acctClient = new FakeSocket();
    hub.attachAgent("pid", agent, ACC);
    hub.attachClient("pid", legacy); // /v1/clients/:pid
    hub.attachAccountClient(ACC, acctClient); // /v1/account/stream
    hub.forwardAgentToClients("pid", "pending-1");
    expect(legacy.sent.at(-1)).toBe("pending-1");
    expect(acctClient.sent.at(-1)).toBe("pending-1");
  });

  it("account client message broadcasts to all agents in the account", () => {
    const hub = createPairingHub();
    const agentA = new FakeSocket();
    const agentB = new FakeSocket();
    const acctClient = new FakeSocket();
    hub.attachAgent("pidA", agentA, ACC);
    hub.attachAgent("pidB", agentB, ACC);
    hub.attachAccountClient(ACC, acctClient);
    hub.forwardAccountClientToAgents(ACC, "decide-xyz");
    expect(agentA.sent.at(-1)).toBe("decide-xyz");
    expect(agentB.sent.at(-1)).toBe("decide-xyz");
  });

  it("account client gets aggregate agent-status and updates on agent online/offline", () => {
    const hub = createPairingHub();
    const acctClient = new FakeSocket();
    hub.attachAccountClient(ACC, acctClient);
    // 接続時点で agent はいない → offline
    expect(acctClient.sent[0]).toBe(JSON.stringify({ type: "agent-status", online: false }));
    const agent = new FakeSocket();
    const { detach } = hub.attachAgent("pid", agent, ACC);
    expect(acctClient.sent.at(-1)).toBe(JSON.stringify({ type: "agent-status", online: true }));
    detach();
    expect(acctClient.sent.at(-1)).toBe(JSON.stringify({ type: "agent-status", online: false }));
    expect(hub.isAccountOnline(ACC)).toBe(false);
  });

  it("account fan-out is isolated per account", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const other = new FakeSocket();
    hub.attachAgent("pid", agent, ACC);
    hub.attachAccountClient("acc-2", other); // 別アカウント
    hub.forwardAgentToClients("pid", "secret");
    expect(other.sent.some((m) => m === "secret")).toBe(false);
  });
});
