import { describe, expect, it } from "vitest";
import { WsClientMessageSchema, WsServerMessageSchema } from "./ws.js";

const sampleRequest = {
  id: "00000000-0000-4000-8000-000000000000",
  created_at: 1700000000000,
  resolved_at: null,
  session_id: "abc",
  session_tag: null,
  tool_name: "Bash",
  tool_input: { command: "ls" },
  cwd: "/tmp",
  decision: null,
  decided_by: null,
  reason: null,
};

describe("WsServerMessageSchema", () => {
  it("parses snapshot", () => {
    const m = WsServerMessageSchema.parse({ type: "snapshot", pending: [sampleRequest] });
    expect(m.type).toBe("snapshot");
  });

  it("parses pending", () => {
    const m = WsServerMessageSchema.parse({ type: "pending", request: sampleRequest });
    expect(m.type).toBe("pending");
  });

  it("parses resolved", () => {
    const m = WsServerMessageSchema.parse({
      type: "resolved",
      id: "00000000-0000-4000-8000-000000000000",
      decision: "allow",
    });
    expect(m.type).toBe("resolved");
  });
});

describe("WsClientMessageSchema", () => {
  it("parses decide without promote", () => {
    const m = WsClientMessageSchema.parse({
      type: "decide",
      id: "00000000-0000-4000-8000-000000000000",
      decision: "allow",
    });
    expect(m.type).toBe("decide");
  });

  it("parses decide with promote", () => {
    const m = WsClientMessageSchema.parse({
      type: "decide",
      id: "00000000-0000-4000-8000-000000000000",
      decision: "allow",
      promote: {
        rule_name: "git-status",
        match: { tool: "Bash", command_matches: "^git status\\b" },
      },
    });
    expect(m.type).toBe("decide");
  });
});
