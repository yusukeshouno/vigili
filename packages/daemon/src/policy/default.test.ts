import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_YAML } from "./default.js";
import { loadPolicyFile } from "./loader.js";

describe("DEFAULT_POLICY_YAML", () => {
  it("parses + passes invariant validation + has a non-empty rules list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vigili-default-policy-"));
    const p = join(dir, "policy.yaml");
    writeFileSync(p, DEFAULT_POLICY_YAML, "utf-8");
    const cfg = await loadPolicyFile(p);
    expect(cfg.defaults.unknown).toBe("ask");
    expect(cfg.defaults.timeout_seconds).toBeGreaterThan(0);
    expect(cfg.rules.length).toBeGreaterThan(5);
  });

  it("does not contain project-specific repo names", () => {
    // 個人プロジェクト名が紛れ込んでないことを CI で保証する。
    const banned = ["neort-wiki", "diptych", "pluris", "passage", "eizo100", "neort-archive", "sentinel"];
    for (const word of banned) {
      expect(DEFAULT_POLICY_YAML).not.toContain(word);
    }
  });
});
