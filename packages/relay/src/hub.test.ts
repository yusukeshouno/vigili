import { describe, expect, it } from "vitest";
import { createPairingHub, type HubSocket } from "./hub.js";

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

describe("PairingHub", () => {
  it("fan-out from agent to multiple clients", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const c1 = new FakeSocket();
    const c2 = new FakeSocket();
    hub.attachAgent("pid", agent);
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
    hub.attachAgent("pid", agent);
    hub.attachClient("pid", c1);
    hub.forwardClientToAgent("pid", "decide");
    expect(agent.sent.at(-1)).toBe("decide");
  });

  it("clients receive agent-status on attach and on agent detach", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const client = new FakeSocket();
    const { detach: detachAgent } = hub.attachAgent("pid", agent);
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
    hub.attachAgent("pid", oldAgent);
    hub.attachAgent("pid", newAgent);
    expect(oldAgent.closed).toBe(true);
    expect(hub.isAgentOnline("pid")).toBe(true);
  });

  it("cleans up pairing when no agent and no clients remain", () => {
    const hub = createPairingHub();
    const agent = new FakeSocket();
    const client = new FakeSocket();
    const a = hub.attachAgent("pid", agent);
    const c = hub.attachClient("pid", client);
    expect(hub.size()).toBe(1);
    a.detach();
    c.detach();
    expect(hub.size()).toBe(0);
  });
});
