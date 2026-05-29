import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * ~/.sentinel/config.yaml の構造 (SPEC.md §5.2)。
 * policy.yaml と違って起動時に必須ではない — ファイルがなければ全てデフォルト。
 */
export const ConfigSchema = z
  .object({
    daemon: z
      .object({
        ws_port: z.number().int().positive().default(7878),
        // LAN 上の他デバイス (iPhone 等) からも繋げるよう 0.0.0.0 default。
        // 認証は Bearer token (Unix socket は別ルートで gate 専用なので保護される)。
        ws_host: z.string().default("0.0.0.0"),
        // decision が付かないまま残った pending を回収するまでの TTL (秒)。
        // gate の ask タイムアウト (300s) より少し長くして、正常応答中の
        // リクエストを誤って expired にしないようにする。
        pending_ttl_seconds: z.number().int().positive().default(360),
      })
      .default({}),
    ntfy: z
      .object({
        server: z.string().url().default("https://ntfy.sh"),
        topic: z.string().min(1),
        priority_map: z
          .object({
            normal: z.number().int().min(1).max(5).default(3),
            critical: z.number().int().min(1).max(5).default(5),
          })
          .default({}),
      })
      .optional(),
    /**
     * Web Push (W3C Push API) の設定。デフォルトで有効。
     * 無効化したいときだけ `push: { enabled: false }` と書く。
     */
    push: z
      .object({
        enabled: z.boolean().default(true),
        /** VAPID 鍵を生成するときの subject (mailto: または https://)。 */
        subject: z.string().default("mailto:sentinel@localhost"),
      })
      .default({}),
    session_tags: z.record(z.string().min(1)).default({}),
    pwa: z
      .object({
        /** PWA の公開 URL。push 通知 / ntfy のタップ後遷移に使う (タップで /r/[id] へ)。
         *  例: https://my-machine.tail-XXXX.ts.net  ( Tailscale Funnel 経由 ) */
        base_url: z.string().url().optional(),
      })
      .default({}),
    /**
     * Vigili Cloud Relay への outbound 接続設定 (Phase 14-B)。
     * 設定時、daemon は LAN WS と並行で relay.vigili.io 等に WSS を張り、
     * pending/decide を双方ルーティングする (外出先からの iOS 接続用)。
     */
    relay: z
      .object({
        /** 例: "wss://relay.vigili.io" (末尾スラなし、/v1/agents/<pid> を後ろに付ける) */
        url: z.string().url(),
        /** Pairing ID (UUID)。relay の /v1/pairings 発行時に取得。 */
        pairing_id: z.string().min(1),
        /** Agent key (relay が `pairings.agent_key_hash` で照合)。発行時に一度だけ平文。 */
        agent_key: z.string().min(1),
        /** 再接続の最大 backoff 秒 (デフォルト 30 秒)。 */
        reconnect_max_seconds: z.number().int().positive().default(30),
      })
      .optional(),
  })
  .default({});

export type SentinelConfig = z.infer<typeof ConfigSchema>;

export class ConfigLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ConfigLoadError";
  }
}

/**
 * config.yaml をロードする。ファイル不在は ConfigLoadError ではなく
 * 「デフォルトのみ」を返す (config はオプショナル)。
 * 文法エラー / スキーマ違反は ConfigLoadError として throw。
 */
export async function loadConfigFile(path: string): Promise<SentinelConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return ConfigSchema.parse({});
    }
    throw new ConfigLoadError(`config.yaml を読めません: ${path}`, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigLoadError(`config.yaml の YAML パースに失敗: ${path}`, err);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(
      `config.yaml のスキーマ違反: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
