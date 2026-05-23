import { describe, expect, it } from "vitest";
import {
  constantTimeEqualString,
  generatePairingId,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./auth.js";

describe("auth", () => {
  it("hashPassword round-trips with verifyPassword", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects too-short passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$xx$yy")).toBe(false);
  });

  it("generateToken returns URL-safe high-entropy strings", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashToken is deterministic and 64 hex chars (sha256)", () => {
    const h1 = hashToken("abc");
    const h2 = hashToken("abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("constantTimeEqualString returns expected results", () => {
    expect(constantTimeEqualString("a", "a")).toBe(true);
    expect(constantTimeEqualString("a", "b")).toBe(false);
    expect(constantTimeEqualString("a", "aa")).toBe(false);
  });

  it("generatePairingId returns a UUID", () => {
    const id = generatePairingId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
