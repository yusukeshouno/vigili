import { describe, expect, it } from "vitest";
import { ApprovalRequestSchema } from "./approval-request.js";

describe("ApprovalRequestSchema", () => {
  it("parses a pending row", () => {
    const r = ApprovalRequestSchema.parse({
      id: "00000000-0000-4000-8000-000000000000",
      created_at: 1700000000000,
      resolved_at: null,
      session_id: "s",
      session_tag: null,
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      decision: null,
      decided_by: null,
      reason: null,
    });
    expect(r.decision).toBeNull();
  });

  it("parses a resolved row", () => {
    const r = ApprovalRequestSchema.parse({
      id: "00000000-0000-4000-8000-000000000000",
      created_at: 1700000000000,
      resolved_at: 1700000001000,
      session_id: "s",
      session_tag: "neort-wiki",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      decision: "allow",
      decided_by: "policy:読み取り専用 bash",
      reason: null,
    });
    expect(r.decision).toBe("allow");
  });
});
