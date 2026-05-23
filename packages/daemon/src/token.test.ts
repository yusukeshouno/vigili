import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateToken } from "./token.js";

describe("loadOrCreateToken", () => {
  it("creates a new token on first call", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-token-"));
    const path = join(dir, "token");
    const t = loadOrCreateToken(path);
    expect(t).toMatch(/^[0-9a-f]{64}$/u);
    expect(readFileSync(path, "utf-8")).toBe(t);
  });

  it("returns existing token on subsequent calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-token-"));
    const path = join(dir, "token");
    const a = loadOrCreateToken(path);
    const b = loadOrCreateToken(path);
    expect(a).toBe(b);
  });

  it("file permissions are 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-token-"));
    const path = join(dir, "token");
    loadOrCreateToken(path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
