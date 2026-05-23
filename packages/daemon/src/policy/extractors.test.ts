import type { ToolRequest } from "@vigili/shared";
import { describe, expect, it } from "vitest";
import { extractCommand, extractPath, extractUrl, inferRepoTag } from "./extractors.js";

const base = { cwd: "/tmp", session_id: "s" } as const;

describe("extractCommand", () => {
  it("returns command for Bash", () => {
    expect(extractCommand({ ...base, tool_name: "Bash", tool_input: { command: "ls" } })).toBe(
      "ls",
    );
  });
  it("returns undefined for non-Bash", () => {
    expect(
      extractCommand({ ...base, tool_name: "Edit", tool_input: { command: "rm -rf /" } }),
    ).toBeUndefined();
  });
  it("returns undefined when command is not a string", () => {
    expect(
      extractCommand({ ...base, tool_name: "Bash", tool_input: { command: 123 } }),
    ).toBeUndefined();
  });
});

describe("extractPath", () => {
  it("returns file_path for Edit", () => {
    expect(
      extractPath({
        ...base,
        tool_name: "Edit",
        tool_input: { file_path: "/x/y.ts", old_string: "a", new_string: "b" },
      }),
    ).toBe("/x/y.ts");
  });
  it("falls back to 'path' if 'file_path' missing", () => {
    expect(extractPath({ ...base, tool_name: "Write", tool_input: { path: "/x" } })).toBe("/x");
  });
  it("returns undefined for Bash", () => {
    expect(
      extractPath({ ...base, tool_name: "Bash", tool_input: { file_path: "/x" } }),
    ).toBeUndefined();
  });
});

describe("extractUrl", () => {
  it("returns url for WebFetch", () => {
    expect(
      extractUrl({ ...base, tool_name: "WebFetch", tool_input: { url: "https://x.com" } }),
    ).toBe("https://x.com");
  });
});

describe("inferRepoTag", () => {
  const req: ToolRequest = {
    ...base,
    cwd: "/Users/me/Code/neort-wiki",
    tool_name: "Bash",
    tool_input: { command: "ls" },
  };
  it("uses session_tag when provided", () => {
    expect(inferRepoTag({ ...req, session_tag: "wiki" })).toBe("wiki");
  });
  it("uses session_tags map when matching", () => {
    expect(inferRepoTag(req, { "neort-wiki": "Neort Wiki" })).toBe("Neort Wiki");
  });
  it("falls back to cwd basename", () => {
    expect(inferRepoTag(req)).toBe("neort-wiki");
  });
});
