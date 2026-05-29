import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICY_CATALOG, MINIMAL_POLICY_YAML, DEFAULT_POLICY_YAML } from "./default.js";
import { loadPolicyFile } from "./loader.js";
import { PolicyRuleSchema } from "@vigili/shared";

describe("MINIMAL_POLICY_YAML", () => {
  it("parses + has empty rules list (initial install state)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vigili-minimal-policy-"));
    const p = join(dir, "policy.yaml");
    writeFileSync(p, MINIMAL_POLICY_YAML, "utf-8");
    const cfg = await loadPolicyFile(p);
    expect(cfg.defaults.unknown).toBe("ask");
    expect(cfg.defaults.timeout_seconds).toBeGreaterThan(0);
    expect(cfg.rules).toEqual([]);
  });

  it("DEFAULT_POLICY_YAML is alias of MINIMAL_POLICY_YAML (no rules on first install)", () => {
    expect(DEFAULT_POLICY_YAML).toBe(MINIMAL_POLICY_YAML);
  });

  it("does not contain project-specific repo names", () => {
    const banned = ["neort-wiki", "diptych", "pluris", "passage", "eizo100", "neort-archive", "sentinel"];
    for (const word of banned) {
      expect(MINIMAL_POLICY_YAML).not.toContain(word);
    }
  });
});

describe("POLICY_CATALOG", () => {
  it("each entry is a valid PolicyRule", () => {
    expect(POLICY_CATALOG.length).toBeGreaterThan(5);
    for (const entry of POLICY_CATALOG) {
      expect(() => PolicyRuleSchema.parse(entry.rule)).not.toThrow();
    }
  });

  it("ids are unique", () => {
    const ids = POLICY_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("convenience entries are allow, danger entries are ask + critical", () => {
    for (const entry of POLICY_CATALOG) {
      if (entry.category === "convenience") {
        expect(entry.rule.action).toBe("allow");
      } else {
        expect(entry.rule.action).toBe("ask");
        expect(entry.rule.notify).toBe("critical");
      }
    }
  });
});
