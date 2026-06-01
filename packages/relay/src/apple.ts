/**
 * Sign in with Apple の identity token (JWT) 検証。
 *
 * Mac/iOS アプリが Apple から受け取った `identityToken` を relay が検証してアカウントを
 * 解決する。ネイティブ検証なので Services ID / 秘密鍵は不要 — Apple の公開 JWKS で署名を
 * 検証し、iss / aud(=bundle id) / exp / nonce を確認するだけ。
 *
 * nonce 契約: クライアントは rawNonce を生成し `request.nonce = sha256(rawNonce)` を Apple に
 * 渡す。Apple はその値をそのまま token の `nonce` クレームに載せて返す。クライアントは
 * rawNonce を relay に送り、relay は `sha256(rawNonce) == token.nonce` を定数時間比較する。
 *
 * Env:
 *   APPLE_AUD       許可する audience(bundle id) の CSV。既定 io.vigili.app.shono,io.vigili.mobile.shono
 *   APPLE_JWKS_URI  JWKS の URL。既定 https://appleid.apple.com/auth/keys (テストで差し替え可)
 */

import { createHash } from "node:crypto";
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import { constantTimeEqualString } from "./auth.js";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_DEFAULT = "https://appleid.apple.com/auth/keys";

export interface AppleConfig {
  /** 許可する audience (= アプリの bundle id) のリスト。 */
  audiences: string[];
  /** JWKS エンドポイント。テストではローカルの公開鍵サーバに差し替える。 */
  jwksUri: string;
}

export interface AppleIdentity {
  /** Apple の安定ユーザ ID。アカウントの一意キー。 */
  sub: string;
  /** Apple が提供したメール (初回のみ・private relay の場合あり)。無ければ null。 */
  email: string | null;
}

export interface AppleVerifier {
  readonly enabled: boolean;
  /** 検証成功なら AppleIdentity を返す。失敗時は Error を throw (fail-closed)。 */
  verify(identityToken: string, rawNonce: string): Promise<AppleIdentity>;
}

export function appleConfigFromEnv(): AppleConfig {
  const audiences = (process.env.APPLE_AUD ?? "io.vigili.app.shono,io.vigili.mobile.shono")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const jwksUri = process.env.APPLE_JWKS_URI ?? APPLE_JWKS_DEFAULT;
  return { audiences, jwksUri };
}

export function createAppleVerifier(config: AppleConfig): AppleVerifier {
  // createRemoteJWKSet は JWKS を遅延フェッチし、鍵ローテーションをキャッシュ込みで扱う。
  const jwks = createRemoteJWKSet(new URL(config.jwksUri));
  return {
    enabled: true,
    async verify(identityToken, rawNonce) {
      // 署名・iss・aud・exp は jose が検証する (失敗時 throw)。
      const { payload } = await jwtVerify(identityToken, jwks, {
        issuer: APPLE_ISSUER,
        audience: config.audiences,
      });
      const sub = typeof payload.sub === "string" ? payload.sub : "";
      if (!sub) throw new Error("apple_token_missing_sub");

      // nonce: Apple は token.nonce にクライアントが渡した sha256(rawNonce) をそのまま載せる。
      const expectedNonce = createHash("sha256").update(rawNonce).digest("hex");
      const tokenNonce = (payload as JWTPayload & { nonce?: unknown }).nonce;
      if (typeof tokenNonce !== "string" || !constantTimeEqualString(tokenNonce, expectedNonce)) {
        throw new Error("apple_token_nonce_mismatch");
      }

      const email = typeof payload.email === "string" ? payload.email : null;
      return { sub, email };
    },
  };
}

export function createAppleVerifierFromEnv(log: (m: string) => void): AppleVerifier {
  const config = appleConfigFromEnv();
  log(`[apple] verifier enabled aud=${config.audiences.join(",")}`);
  return createAppleVerifier(config);
}
