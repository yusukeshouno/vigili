import { describe, expect, it } from "vitest";
import { ToolRequestSchema } from "./tool-request.js";

describe("ToolRequestSchema", () => {
  it("accepts a valid Bash request", () => {
    const parsed = ToolRequestSchema.parse({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/tmp",
      session_id: "abc123",
    });
    expect(parsed.tool_name).toBe("Bash");
  });

  it("accepts session_tag", () => {
    const parsed = ToolRequestSchema.parse({
      tool_name: "Edit",
      tool_input: { file_path: "/x" },
      cwd: "/tmp",
      session_id: "abc",
      session_tag: "neort-wiki",
    });
    expect(parsed.session_tag).toBe("neort-wiki");
  });

  it("rejects empty tool_name", () => {
    expect(() =>
      ToolRequestSchema.parse({
        tool_name: "",
        tool_input: {},
        cwd: "/tmp",
        session_id: "abc",
      }),
    ).toThrow();
  });

  it("rejects missing cwd", () => {
    expect(() =>
      ToolRequestSchema.parse({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "abc",
      }),
    ).toThrow();
  });
});
