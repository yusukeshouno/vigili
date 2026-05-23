import type { ToolRequest } from "@sentinel/shared";
import { describe, expect, it } from "vitest";
import { globToRegex, matchClaudePermissions } from "./claude-perms.js";

const bash = (cmd: string): ToolRequest => ({
  tool_name: "Bash",
  tool_input: { command: cmd },
  cwd: "/tmp",
  session_id: "s",
});

describe("globToRegex", () => {
  it("matches literal strings", () => {
    expect(globToRegex("pnpm -r typecheck").test("pnpm -r typecheck")).toBe(true);
    expect(globToRegex("pnpm -r typecheck").test("pnpm -r typechec")).toBe(false);
  });
  it("expands * to any characters", () => {
    expect(globToRegex("pnpm lint *").test("pnpm lint src/")).toBe(true);
    expect(globToRegex("git status*").test("git status --porcelain")).toBe(true);
    expect(globToRegex("git status*").test("git pull")).toBe(false);
  });
  it("escapes regex metacharacters", () => {
    expect(globToRegex("a.b").test("a.b")).toBe(true);
    expect(globToRegex("a.b").test("axb")).toBe(false);
  });
});

describe("matchClaudePermissions", () => {
  it("matches exact Bash command", () => {
    const r = matchClaudePermissions(
      { allow: ["Bash(pnpm -r typecheck)"], deny: [] },
      bash("pnpm -r typecheck"),
    );
    expect(r.matched).toBe(true);
    expect(r.reason).toBe("allow");
  });

  it("matches wildcard Bash command", () => {
    const r = matchClaudePermissions(
      { allow: ["Bash(pnpm lint *)"], deny: [] },
      bash("pnpm lint src/"),
    );
    expect(r.matched).toBe(true);
  });

  it("does not match when prefix differs", () => {
    const r = matchClaudePermissions(
      { allow: ["Bash(pnpm lint *)"], deny: [] },
      bash("pnpm build"),
    );
    expect(r.matched).toBe(false);
  });

  it("deny wins over allow", () => {
    const r = matchClaudePermissions(
      { allow: ["Bash(*)"], deny: ["Bash(rm -rf *)"] },
      bash("rm -rf /tmp/foo"),
    );
    expect(r.matched).toBe(true);
    expect(r.reason).toBe("deny");
  });

  it("ignores patterns for other tools", () => {
    const r = matchClaudePermissions({ allow: ["Edit(**/*.tsx)"], deny: [] }, bash("ls"));
    expect(r.matched).toBe(false);
  });

  it("matches Edit by file_path glob", () => {
    const req: ToolRequest = {
      tool_name: "Edit",
      tool_input: { file_path: "src/components/Foo.tsx", old_string: "x", new_string: "y" },
      cwd: "/tmp",
      session_id: "s",
    };
    const r = matchClaudePermissions({ allow: ["Edit(*.tsx)"], deny: [] }, req);
    expect(r.matched).toBe(true);
  });

  it("matches WebFetch by domain prefix", () => {
    const req: ToolRequest = {
      tool_name: "WebFetch",
      tool_input: { url: "https://api.github.com/repos" },
      cwd: "/tmp",
      session_id: "s",
    };
    const r = matchClaudePermissions({ allow: ["WebFetch(domain:github.com)"], deny: [] }, req);
    expect(r.matched).toBe(true);
  });

  it("WebFetch domain match is exact + subdomain", () => {
    const inner = matchClaudePermissions(
      { allow: ["WebFetch(domain:example.com)"], deny: [] },
      {
        tool_name: "WebFetch",
        tool_input: { url: "https://other.com/example.com" },
        cwd: "/tmp",
        session_id: "s",
      },
    );
    expect(inner.matched).toBe(false);
  });

  it("empty inside matches any command for that tool", () => {
    const r = matchClaudePermissions({ allow: ["Bash"], deny: [] }, bash("anything"));
    expect(r.matched).toBe(true);
  });
});
