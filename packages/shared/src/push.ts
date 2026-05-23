import { z } from "zod";

/**
 * W3C Push API の PushSubscription.toJSON() 形状。
 *
 * - `endpoint`: ブラウザ各社の push service の URL (FCM / APNs プロキシ等)
 * - `keys.p256dh`: P-256 ECDH の公開鍵 (base64url)
 * - `keys.auth`: 16 bytes の認証シークレット (base64url)
 *
 * daemon はこの 3 つを `~/.sentinel/push-subs.json` に保存し、
 * web-push ライブラリで encrypted payload を POST する。
 */

export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export const PushSubscriptionJsonSchema = z.object({
  endpoint: z.string().url(),
  keys: PushSubscriptionKeysSchema,
  /** オプション: PWA 側で記録した「いつ subscribe したか」(ms)。サーバには出さない。 */
  expirationTime: z.number().int().nullable().optional(),
});

export type PushSubscriptionJson = z.infer<typeof PushSubscriptionJsonSchema>;

/**
 * SW の push event で受け取るメッセージ。
 *
 * Sentinel は decrypted payload に最低限 `title` と `body` を入れ、
 * `data.url` でタップ後の遷移先 (例: /r/<id>) を伝える。
 */
export const PushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  /** 同一 request_id の通知が複数飛んだ時、後勝ちで上書きするための tag。 */
  tag: z.string().optional(),
  /** タップ時に PWA で開く URL。/r/<id> を想定。 */
  url: z.string().optional(),
  /** "normal" / "critical"。SW は critical のとき requireInteraction: true にする。 */
  level: z.enum(["normal", "critical"]).default("normal"),
});

export type PushPayload = z.infer<typeof PushPayloadSchema>;
