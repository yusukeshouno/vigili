/**
 * Apple identity token 検証の単体テスト。
 *
 * ローカルに RSA 鍵ペアを生成し、その公開鍵だけを載せた JWKS を node:http で配信する。
 * テスト用トークンは秘密鍵で RS256 署名し、createAppleVerifier({jwksUri}) で検証する。
 * 本物の Apple JWKS には触れない。
 */

import { createHash } from "node:crypto";
import { type Server, createServer } from "node:http";
import { type JWK, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppleVerifier } from "./apple.js";

const ISSUER = "https://appleid.apple.com";
const AUD = "io.vigili.mobile";
const KID = "test-key-1";

let server: Server;
let jwksUri: string;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;

beforeEach(async () => {
  keys = await generateKeyPair("RS256");
  const jwk: JWK = await exportJWK(keys.publicKey);
  jwk.kid = KID;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const body = JSON.stringify({ keys: [jwk] });
  server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("no addr");
  jwksUri = `http://127.0.0.1:${addr.port}/keys`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface TokenOpts {
  sub?: string | null;
  aud?: string;
  iss?: string;
  nonceClaim?: string | null;
  email?: string;
  expSeconds?: number;
  kid?: string;
  signWith?: typeof keys.privateKey;
}

async function makeToken(opts: TokenOpts = {}): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (opts.nonceClaim != null) payload.nonce = opts.nonceClaim;
  if (opts.email !== undefined) payload.email = opts.email;
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expSeconds ?? Math.floor(Date.now() / 1000) + 300);
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? "apple-sub-123");
  return jwt.sign(opts.signWith ?? keys.privateKey);
}

describe("apple verifier", () => {
  it("accepts a valid token and returns sub + email", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const rawNonce = "raw-nonce-abc";
    const token = await makeToken({
      nonceClaim: sha256hex(rawNonce),
      email: "x@privaterelay.appleid.com",
    });
    const id = await v.verify(token, rawNonce);
    expect(id.sub).toBe("apple-sub-123");
    expect(id.email).toBe("x@privaterelay.appleid.com");
  });

  it("returns null email when token has no email claim", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const rawNonce = "n";
    const token = await makeToken({ nonceClaim: sha256hex(rawNonce) });
    const id = await v.verify(token, rawNonce);
    expect(id.email).toBeNull();
  });

  it("accepts when aud is one of multiple allowed audiences", async () => {
    const v = createAppleVerifier({
      audiences: ["io.vigili.app.shono", AUD],
      jwksUri,
    });
    const rawNonce = "n";
    const token = await makeToken({ nonceClaim: sha256hex(rawNonce) });
    await expect(v.verify(token, rawNonce)).resolves.toMatchObject({ sub: "apple-sub-123" });
  });

  it("rejects wrong audience", async () => {
    const v = createAppleVerifier({ audiences: ["io.other.app"], jwksUri });
    const rawNonce = "n";
    const token = await makeToken({ nonceClaim: sha256hex(rawNonce) });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  it("rejects wrong issuer", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const rawNonce = "n";
    const token = await makeToken({ iss: "https://evil.example", nonceClaim: sha256hex(rawNonce) });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  it("rejects expired token", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const rawNonce = "n";
    const token = await makeToken({
      nonceClaim: sha256hex(rawNonce),
      expSeconds: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  it("rejects nonce mismatch", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const token = await makeToken({ nonceClaim: sha256hex("different") });
    await expect(v.verify(token, "raw-nonce-abc")).rejects.toBeDefined();
  });

  it("rejects missing nonce claim", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const token = await makeToken({ nonceClaim: null });
    await expect(v.verify(token, "whatever")).rejects.toBeDefined();
  });

  it("rejects missing sub", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    const rawNonce = "n";
    const token = await makeToken({ sub: null, nonceClaim: sha256hex(rawNonce) });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  it("rejects a token signed by an unknown key (bad signature)", async () => {
    const other = await generateKeyPair("RS256");
    const rawNonce = "n";
    const token = await makeToken({
      nonceClaim: sha256hex(rawNonce),
      kid: "unknown-kid",
      signWith: other.privateKey,
    });
    const v = createAppleVerifier({ audiences: [AUD], jwksUri });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  it("fails closed when JWKS endpoint is unreachable", async () => {
    const v = createAppleVerifier({ audiences: [AUD], jwksUri: "http://127.0.0.1:1/keys" });
    const rawNonce = "n";
    const token = await makeToken({ nonceClaim: sha256hex(rawNonce) });
    await expect(v.verify(token, rawNonce)).rejects.toBeDefined();
  });

  // Web Sign in (SPEC §10.5): nonce 検証なし、aud=Services ID。
  const SERVICES_ID = "io.vigili.signin";

  it("verifyWeb accepts a valid id_token without a nonce claim", async () => {
    const v = createAppleVerifier({ audiences: [SERVICES_ID], jwksUri });
    const token = await makeToken({ aud: SERVICES_ID, email: "web@x.co" });
    const id = await v.verifyWeb(token);
    expect(id.sub).toBe("apple-sub-123");
    expect(id.email).toBe("web@x.co");
  });

  it("verifyWeb still rejects bad aud / expired / bad signature / missing sub", async () => {
    const v = createAppleVerifier({ audiences: [SERVICES_ID], jwksUri });
    await expect(v.verifyWeb(await makeToken({ aud: "io.vigili.mobile" }))).rejects.toBeDefined();
    const expired = await makeToken({
      aud: SERVICES_ID,
      expSeconds: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(v.verifyWeb(expired)).rejects.toBeDefined();
    const other = await generateKeyPair("RS256");
    const badSig = await makeToken({ aud: SERVICES_ID, kid: "x", signWith: other.privateKey });
    await expect(v.verifyWeb(badSig)).rejects.toBeDefined();
    await expect(
      v.verifyWeb(await makeToken({ aud: SERVICES_ID, sub: null })),
    ).rejects.toBeDefined();
  });
});
