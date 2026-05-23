import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "./loader.js";
import { appendGeneratedRule, promoteToRule } from "./promote.js";

/**
 * loader が main の specific ルール → generated ルール → main の catch-all
 * の順でマージするかを検証する (Phase 7 の核となるバグの回帰防止)。
 */
describe("loader merges generated rules before catch-all", () => {
  it("generated rule wins over a Bash catch-all when both match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-merge-"));
    const main = join(dir, "policy.yaml");
    const generated = join(dir, "policy.generated.yaml");

    writeFileSync(
      main,
      `defaults:
  unknown: ask
  timeout_seconds: 300
rules:
  - name: "ls allow"
    when:
      tool: Bash
      command_matches: '^ls\\\\b'
    action: allow
  - name: "untyped Bash"
    when:
      tool: Bash
    action: ask
`,
      "utf-8",
    );
    await appendGeneratedRule(
      generated,
      promoteToRule({
        rule_name: "Bash: curl",
        match: { tool: "Bash", command_matches: "^curl\\b" },
      }),
    );

    const cfg = await loadPolicyFile(main);
    const names = cfg.rules.map((r) => r.name);
    // specific (ls allow) → generated (Bash: curl) → catch-all (untyped Bash)
    expect(names).toEqual(["ls allow", "Bash: curl", "untyped Bash"]);
  });

  it("works with no generated file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-merge-"));
    const main = join(dir, "policy.yaml");
    writeFileSync(
      main,
      `defaults:
  unknown: ask
  timeout_seconds: 300
rules:
  - name: "ls"
    when: { tool: Bash, command_matches: '^ls\\\\b' }
    action: allow
`,
      "utf-8",
    );
    const cfg = await loadPolicyFile(main);
    expect(cfg.rules.map((r) => r.name)).toEqual(["ls"]);
  });
});
