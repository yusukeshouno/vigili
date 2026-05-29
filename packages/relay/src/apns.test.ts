/**
 * APNs provider-token (JWT) 組み立てと env パースの単体テスト。
 * 実際の HTTP/2 送信 (Apple への接続) はここでは検証しない。
 */

import { verify as cryptoVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apnsConfigFromEnv, buildProviderToken, createApnsSenderFromEnv } from "./apns.js";

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

describe("apnsConfigFromEnv", () => {
  it("returns null when any required var is missing", () => {
    expect(apnsConfigFromEnv({})).toBeNull();
    expect(
      apnsConfigFromEnv({ APNS_KEY_PATH: "/x", APNS_KEY_ID: "k", APNS_TEAM_ID: "t" }),
    ).toBeNull();
  });

  it("parses a full env and defaults env to sandbox", () => {
    const cfg = apnsConfigFromEnv({
      APNS_KEY_PATH: "/x.p8",
      APNS_KEY_ID: "KEY1234567",
      APNS_TEAM_ID: "TEAM123456",
      APNS_TOPIC: "io.vigili.mobile.shono",
    });
    expect(cfg).toMatchObject({
      keyPath: "/x.p8",
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      topic: "io.vigili.mobile.shono",
      env: "sandbox",
    });
  });

  it("maps production / prod to production", () => {
    const common = {
      APNS_KEY_PATH: "/x",
      APNS_KEY_ID: "k",
      APNS_TEAM_ID: "t",
      APNS_TOPIC: "top",
    };
    expect(apnsConfigFromEnv({ ...common, APNS_ENV: "production" })?.env).toBe("production");
    expect(apnsConfigFromEnv({ ...common, APNS_ENV: "prod" })?.env).toBe("production");
    expect(apnsConfigFromEnv({ ...common, APNS_ENV: "anything" })?.env).toBe("sandbox");
  });
});

describe("buildProviderToken", () => {
  it("produces a verifiable ES256 JWT with raw r||s signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const now = 1_700_000_000;
    const jwt = buildProviderToken(privateKey, "KEY1234567", "TEAM123456", now);

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(b64urlToBuf(parts[0] as string).toString("utf-8"));
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });

    const payload = JSON.parse(b64urlToBuf(parts[1] as string).toString("utf-8"));
    expect(payload).toMatchObject({ iss: "TEAM123456", iat: now });

    const sig = b64urlToBuf(parts[2] as string);
    // P-256 の JOSE raw r||s 署名は 64 byte 固定 (DER ではない)
    expect(sig.length).toBe(64);

    const ok = cryptoVerify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      sig,
    );
    expect(ok).toBe(true);
  });
});

describe("createApnsSenderFromEnv", () => {
  it("returns a disabled (no-op) sender when unconfigured", async () => {
    const sender = createApnsSenderFromEnv(() => undefined, {});
    expect(sender.enabled).toBe(false);
    const r = await sender.send("tok", { title: "t", body: "b" });
    expect(r.status).toBe(0);
    expect(r.unregistered).toBe(false);
    sender.close();
  });
});
