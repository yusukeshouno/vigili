import { describe, expect, it } from "vitest";
import { PolicyConfigSchema, PolicyRuleSchema, RuleWhenSchema } from "./policy.js";

describe("RuleWhenSchema", () => {
  it("requires at least one condition", () => {
    expect(() => RuleWhenSchema.parse({})).toThrow(/少なくとも 1 つの条件/u);
  });

  it("accepts single condition", () => {
    expect(RuleWhenSchema.parse({ tool: "Bash" }).tool).toBe("Bash");
  });

  it("validates time_between HH:MM", () => {
    expect(() => RuleWhenSchema.parse({ time_between: ["25:00", "07:00"] })).toThrow();
    expect(() => RuleWhenSchema.parse({ time_between: ["02:00", "07:00"] })).not.toThrow();
  });

  it("accepts tool as array", () => {
    const w = RuleWhenSchema.parse({ tool: ["Edit", "Write"] });
    expect(w.tool).toEqual(["Edit", "Write"]);
  });
});

describe("PolicyRuleSchema", () => {
  it("allows notify only with action=ask", () => {
    expect(() =>
      PolicyRuleSchema.parse({
        name: "x",
        when: { tool: "Bash" },
        action: "allow",
        notify: "normal",
      }),
    ).toThrow(/notify は action: ask のときのみ/u);

    expect(() =>
      PolicyRuleSchema.parse({
        name: "x",
        when: { tool: "Bash" },
        action: "ask",
        notify: "critical",
      }),
    ).not.toThrow();
  });
});

describe("PolicyConfigSchema", () => {
  it("parses a minimal config", () => {
    const cfg = PolicyConfigSchema.parse({
      defaults: { unknown: "ask", timeout_seconds: 300 },
    });
    expect(cfg.rules).toEqual([]);
    expect(cfg.defaults.unknown).toBe("ask");
  });

  it("parses the example shape", () => {
    const cfg = PolicyConfigSchema.parse({
      defaults: { unknown: "ask", timeout_seconds: 300 },
      rules: [
        {
          name: "読み取り専用 bash",
          when: { tool: "Bash", command_matches: "^ls\\b" },
          action: "allow",
        },
        {
          name: ".env への書き込み",
          when: { tool: ["Edit", "Write"], path_matches: "\\.env$" },
          action: "ask",
          notify: "critical",
        },
      ],
    });
    expect(cfg.rules).toHaveLength(2);
  });
});
