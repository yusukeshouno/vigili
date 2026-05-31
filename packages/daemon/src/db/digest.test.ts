import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bashCommandFamily,
  computeDigest,
  pathExtension,
  renderRuleYaml,
  urlHost,
} from "./digest.js";
import { openStore, type RequestStore } from "./store.js";

let store: RequestStore;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vigili-digest-"));
  store = openStore(join(dir, "queue.db"));
});

afterEach(() => {
  store.close();
});

function insert(opts: {
  tool: string;
  input: Record<string, unknown>;
  decided_by: string;
  decision: "allow" | "deny";
  created_at?: number;
}): void {
  const id = randomUUID();
  const created = opts.created_at ?? Date.now();
  store.insert({
    id,
    created_at: created,
    session_id: "s",
    session_tag: null,
    tool_name: opts.tool,
    tool_input: opts.input,
    cwd: "/tmp",
  });
  store.resolve({
    id,
    resolved_at: created + 500,
    decision: opts.decision,
    decided_by: opts.decided_by,
    reason: null,
  });
}

describe("bashCommandFamily", () => {
  it("groups by first two tokens for non-flag commands", () => {
    expect(bashCommandFamily("git push origin main")).toBe("git push");
    expect(bashCommandFamily("git status")).toBe("git status");
  });
  it("falls back to one token if 2nd is a flag", () => {
    expect(bashCommandFamily("curl -sS https://x")).toBe("curl");
  });
  it("falls back to one token if 2nd is a path/url/quote", () => {
    expect(bashCommandFamily("curl https://api.openai.com")).toBe("curl");
    expect(bashCommandFamily('rm "/tmp/foo"')).toBe("rm");
    expect(bashCommandFamily("ls /usr/local")).toBe("ls");
  });
  it("returns null for empty", () => {
    expect(bashCommandFamily("   ")).toBeNull();
  });
});

describe("pathExtension", () => {
  it("returns dotted ext for normal files", () => {
    expect(pathExtension("/Users/x/foo.ts")).toBe(".ts");
    expect(pathExtension("foo.tsx")).toBe(".tsx");
  });
  it("returns the whole name for dotfiles", () => {
    expect(pathExtension("/Users/x/.env")).toBe(".env");
    expect(pathExtension(".gitignore")).toBe(".gitignore");
  });
  it("returns null for extensionless files", () => {
    expect(pathExtension("/Users/x/Makefile")).toBeNull();
  });
});

describe("urlHost", () => {
  it("extracts host", () => {
    expect(urlHost("https://api.openai.com/v1/chat")).toBe("api.openai.com");
  });
  it("returns null for garbage", () => {
    expect(urlHost("not a url")).toBeNull();
  });
});

describe("renderRuleYaml", () => {
  it("formats a Bash allow rule with command_matches", () => {
    const yaml = renderRuleYaml({
      name: "digest: git push",
      when: { tool: "Bash", command_matches: "^git\\s+push\\b" },
      action: "allow",
    });
    expect(yaml).toContain('- name: "digest: git push"');
    expect(yaml).toContain("tool: Bash");
    expect(yaml).toContain("command_matches: '^git\\s+push\\b'");
    expect(yaml).toContain("action: allow");
  });
});

describe("computeDigest", () => {
  it("groups identical bash commands and proposes promotion when unanimous-allow ≥3", () => {
    const { db } = store.raw();
    const t = Date.now();
    for (let i = 0; i < 5; i++) {
      insert({
        tool: "Bash",
        input: { command: `git push origin feat-${i}` },
        decided_by: "human:ws",
        decision: "allow",
        created_at: t + i,
      });
    }
    const r = computeDigest(db, t - 1000, t + 10_000);
    expect(r.totals.manual_rows).toBe(5);
    expect(r.groups.length).toBe(1);
    const g = r.groups[0]!;
    expect(g.key).toBe("Bash:git push");
    expect(g.count).toBe(5);
    expect(g.unanimous).toBe("allow");
    expect(g.all_human).toBe(true);
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]!.rule.action).toBe("allow");
    expect(r.candidates[0]!.rule_yaml).toContain("command_matches");
  });

  it("excludes groups with auto-rule decisions from candidates", () => {
    const { db } = store.raw();
    const t = Date.now();
    insert({
      tool: "Bash",
      input: { command: "ls /tmp" },
      decided_by: "rule:read-only",
      decision: "allow",
      created_at: t,
    });
    insert({
      tool: "Bash",
      input: { command: "ls /var" },
      decided_by: "rule:read-only",
      decision: "allow",
      created_at: t + 1,
    });
    insert({
      tool: "Bash",
      input: { command: "ls /etc" },
      decided_by: "rule:read-only",
      decision: "allow",
      created_at: t + 2,
    });
    const r = computeDigest(db, t - 1000, t + 10_000);
    const g = r.groups.find((x) => x.key === "Bash:ls")!;
    expect(g.count).toBe(3);
    expect(g.all_human).toBe(false);
    expect(r.candidates.find((c) => c.group.key === "Bash:ls")).toBeUndefined();
  });

  it("excludes mixed allow/deny groups from candidates", () => {
    const { db } = store.raw();
    const t = Date.now();
    insert({
      tool: "Bash",
      input: { command: "curl https://x.com" },
      decided_by: "human:ws",
      decision: "allow",
      created_at: t,
    });
    insert({
      tool: "Bash",
      input: { command: "curl https://y.com" },
      decided_by: "human:ws",
      decision: "allow",
      created_at: t + 1,
    });
    insert({
      tool: "Bash",
      input: { command: "curl https://z.com" },
      decided_by: "human:ws",
      decision: "deny",
      created_at: t + 2,
    });
    const r = computeDigest(db, t - 1000, t + 10_000);
    const g = r.groups.find((x) => x.key === "Bash:curl")!;
    expect(g.unanimous).toBeNull();
    expect(r.candidates.find((c) => c.group.key === "Bash:curl")).toBeUndefined();
  });

  it("requires count >= 3 for candidates", () => {
    const { db } = store.raw();
    const t = Date.now();
    insert({
      tool: "Bash",
      input: { command: "yarn install" },
      decided_by: "human:ws",
      decision: "allow",
      created_at: t,
    });
    insert({
      tool: "Bash",
      input: { command: "yarn install" },
      decided_by: "human:ws",
      decision: "allow",
      created_at: t + 1,
    });
    const r = computeDigest(db, t - 1000, t + 10_000);
    expect(r.groups.length).toBe(1);
    expect(r.candidates.length).toBe(0);
  });

  it("groups Edit by extension and Web by host", () => {
    const { db } = store.raw();
    const t = Date.now();
    for (let i = 0; i < 3; i++) {
      insert({
        tool: "Edit",
        input: { file_path: `/x/y/foo${i}.ts` },
        decided_by: "human:cli",
        decision: "allow",
        created_at: t + i,
      });
    }
    for (let i = 0; i < 3; i++) {
      insert({
        tool: "WebFetch",
        input: { url: `https://api.openai.com/v1/${i}` },
        decided_by: "human:ws",
        decision: "deny",
        created_at: t + 10 + i,
      });
    }
    const r = computeDigest(db, t - 1000, t + 10_000);
    expect(r.candidates.length).toBe(2);
    const edit = r.candidates.find((c) => c.group.key === "Edit:.ts")!;
    expect(edit.rule.when.path_matches).toContain(".ts");
    const web = r.candidates.find((c) => c.group.key === "WebFetch:api.openai.com")!;
    expect(web.rule.action).toBe("deny");
    expect(web.rule.when.url_matches).toContain("openai");
  });
});
