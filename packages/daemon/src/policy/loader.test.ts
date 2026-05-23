import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PolicyLoadError,
  loadPolicyFile,
  validatePolicyAgainstInvariants,
  validatePolicyRegexes,
} from "./loader.js";

function tmp(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-policy-"));
  const p = join(dir, "policy.yaml");
  writeFileSync(p, yaml, "utf-8");
  return p;
}

describe("loadPolicyFile", () => {
  it("loads a minimal valid policy", async () => {
    const p = tmp(`defaults:
  unknown: ask
  timeout_seconds: 300
`);
    const cfg = await loadPolicyFile(p);
    expect(cfg.defaults.unknown).toBe("ask");
    expect(cfg.rules).toEqual([]);
  });

  it("rejects YAML with schema errors", async () => {
    const p = tmp(`defaults:
  unknown: whatever
`);
    await expect(loadPolicyFile(p)).rejects.toBeInstanceOf(PolicyLoadError);
  });

  it("rejects when allow-rule would override an invariant", async () => {
    const p = tmp(`defaults:
  unknown: ask
  timeout_seconds: 300
rules:
  - name: dangerous override
    when:
      tool: Bash
      command_matches: '.*'
    action: allow
`);
    await expect(loadPolicyFile(p)).rejects.toThrow(/invariant/u);
  });

  it("rejects bad regex", async () => {
    const p = tmp(`defaults:
  unknown: ask
  timeout_seconds: 300
rules:
  - name: bad regex
    when:
      tool: Bash
      command_matches: '('
    action: allow
`);
    await expect(loadPolicyFile(p)).rejects.toThrow(/正規表現/u);
  });
});

describe("validatePolicyAgainstInvariants", () => {
  it("accepts narrow allow rules", () => {
    expect(() =>
      validatePolicyAgainstInvariants({
        defaults: { unknown: "ask", timeout_seconds: 300 },
        rules: [
          {
            name: "git status only",
            when: { tool: "Bash", command_matches: "^git status\\b" },
            action: "allow",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects allow rules that catch rm -rf /", () => {
    expect(() =>
      validatePolicyAgainstInvariants({
        defaults: { unknown: "ask", timeout_seconds: 300 },
        rules: [
          {
            name: "anything bash",
            when: { tool: "Bash", command_matches: "rm" },
            action: "allow",
          },
        ],
      }),
    ).toThrow(/invariant/u);
  });
});

describe("validatePolicyRegexes", () => {
  it("passes for valid regex", () => {
    expect(() =>
      validatePolicyRegexes({
        defaults: { unknown: "ask", timeout_seconds: 300 },
        rules: [{ name: "ok", when: { tool: "Bash", command_matches: "^ls" }, action: "allow" }],
      }),
    ).not.toThrow();
  });
});
