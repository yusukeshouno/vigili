import type { PolicyConfig, ToolRequest } from "@vigili/shared";
import { describe, expect, it } from "vitest";
import { decide, isWithinJstWindow } from "./engine.js";

const minimalDefaults = { unknown: "ask" as const, timeout_seconds: 300 };

const bash = (command: string, cwd = "/tmp"): ToolRequest => ({
  tool_name: "Bash",
  tool_input: { command },
  cwd,
  session_id: "s",
});

describe("decide", () => {
  it("returns invariant deny first, ignoring later rules", () => {
    const policy: PolicyConfig = {
      defaults: minimalDefaults,
      rules: [{ name: "permissive", when: { tool: "Bash" }, action: "allow" }],
    };
    const r = decide(bash("rm -rf /"), policy);
    expect(r.action).toBe("deny");
    expect(r.source).toMatch(/^invariant:/u);
  });

  it("falls back to default when no rule matches", () => {
    const policy: PolicyConfig = { defaults: minimalDefaults, rules: [] };
    const r = decide(bash("anything"), policy);
    expect(r.action).toBe("ask");
    expect(r.source).toBe("default");
  });

  it("picks the first matching rule", () => {
    const policy: PolicyConfig = {
      defaults: minimalDefaults,
      rules: [
        { name: "ls allow", when: { tool: "Bash", command_matches: "^ls\\b" }, action: "allow" },
        { name: "all ask", when: { tool: "Bash" }, action: "ask" },
      ],
    };
    expect(decide(bash("ls -la"), policy).source).toBe("rule:ls allow");
    expect(decide(bash("echo hi"), policy).source).toBe("rule:all ask");
  });

  it("matches tool array", () => {
    const policy: PolicyConfig = {
      defaults: minimalDefaults,
      rules: [
        {
          name: "edits",
          when: { tool: ["Edit", "Write"], path_matches: "\\.env$" },
          action: "ask",
          notify: "critical",
        },
      ],
    };
    const r = decide(
      {
        tool_name: "Edit",
        tool_input: { file_path: ".env" },
        cwd: "/tmp",
        session_id: "s",
      },
      policy,
    );
    expect(r.action).toBe("ask");
    expect(r.notify).toBe("critical");
  });

  it("respects repo_in", () => {
    const policy: PolicyConfig = {
      defaults: minimalDefaults,
      rules: [
        {
          name: "known repos only",
          when: { tool: "Bash", command_matches: "^pnpm install$", repo_in: ["wiki"] },
          action: "allow",
        },
      ],
    };
    expect(
      decide(bash("pnpm install", "/Users/me/wiki"), policy, {
        sessionTags: {},
      }).action,
    ).toBe("allow");
    expect(
      decide(bash("pnpm install", "/Users/me/random"), policy, {
        sessionTags: {},
      }).action,
    ).toBe("ask");
  });

  it("respects time_between (JST)", () => {
    const policy: PolicyConfig = {
      defaults: minimalDefaults,
      rules: [
        {
          name: "late night fetch",
          when: { tool: "WebFetch", time_between: ["02:00", "07:00"] },
          action: "deny",
        },
      ],
    };
    const webfetch: ToolRequest = {
      tool_name: "WebFetch",
      tool_input: { url: "https://x" },
      cwd: "/tmp",
      session_id: "s",
    };

    // 2026-05-22 04:00 JST = 2026-05-21 19:00 UTC
    const inWindow = new Date(Date.UTC(2026, 4, 21, 19, 0, 0));
    // 2026-05-22 12:00 JST = 2026-05-22 03:00 UTC
    const outWindow = new Date(Date.UTC(2026, 4, 22, 3, 0, 0));

    expect(decide(webfetch, policy, { now: inWindow }).action).toBe("deny");
    expect(decide(webfetch, policy, { now: outWindow }).action).toBe("ask");
  });
});

describe("isWithinJstWindow", () => {
  it("handles same-day windows", () => {
    const t = new Date(Date.UTC(2026, 4, 21, 19, 0, 0)); // 04:00 JST
    expect(isWithinJstWindow("02:00", "07:00", t)).toBe(true);
    expect(isWithinJstWindow("05:00", "07:00", t)).toBe(false);
  });

  it("handles overnight windows", () => {
    // 23:30 JST
    const lateNight = new Date(Date.UTC(2026, 4, 21, 14, 30, 0));
    expect(isWithinJstWindow("22:00", "06:00", lateNight)).toBe(true);
    // 03:00 JST
    const earlyMorning = new Date(Date.UTC(2026, 4, 21, 18, 0, 0));
    expect(isWithinJstWindow("22:00", "06:00", earlyMorning)).toBe(true);
    // 12:00 JST
    const noon = new Date(Date.UTC(2026, 4, 22, 3, 0, 0));
    expect(isWithinJstWindow("22:00", "06:00", noon)).toBe(false);
  });
});
