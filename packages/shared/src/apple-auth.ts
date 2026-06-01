import { z } from "zod";

/**
 * Sign in with Apple によるアカウント中心オンボーディングの共有スキーマ。
 *
 * クライアント (PWA / 将来の web) が relay の `/v1/auth/apple` と `/v1/account/devices`
 * を叩くときの request/response 形状。ネイティブ (Mac/iOS) は Swift 側で同等の型を持つが、
 * ここを唯一の真実として TS 側 (PWA / daemon) は import する。
 */

/** POST /v1/auth/apple のリクエスト。 */
export const AppleAuthRequestSchema = z.object({
  /** Apple から受け取った identity token (JWT)。 */
  identity_token: z.string().min(1).max(8192),
  /** クライアントが生成した raw nonce。relay は sha256(nonce)==token.nonce を検証する。 */
  nonce: z.string().min(1).max(256),
});
export type AppleAuthRequest = z.infer<typeof AppleAuthRequestSchema>;

/** signup / signin / apple すべてで共通の認証成功レスポンス。 */
export const AccountSessionResponseSchema = z.object({
  account: z.object({
    id: z.string(),
    /** Apple が提供したメール (private relay の場合あり)。無ければ null。 */
    email: z.string().nullable(),
  }),
  session: z.object({
    token: z.string(),
    expires_at: z.number().int(),
  }),
});
export type AccountSessionResponse = z.infer<typeof AccountSessionResponseSchema>;

/** POST /v1/account/devices のリクエスト (session 認証, pairing 非依存)。 */
export const AccountDeviceRegisterSchema = z.object({
  apns_token: z.string().min(8).max(256),
  platform: z.enum(["ios", "ipados", "macos"]),
});
export type AccountDeviceRegister = z.infer<typeof AccountDeviceRegisterSchema>;
