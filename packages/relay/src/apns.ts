/**
 * APNs (Apple Push Notification service) provider-token 送信。
 *
 * relay は pairing ごとに登録された iOS device token を保持しており、Mac daemon から
 * `pending` が来た瞬間にここで APNs へ push する。これが「LAN 外でアプリがバックグラウンド
 * のとき、承認待ちを端末に届ける」唯一の経路 (iOS は WS をバックグラウンドでサスペンドする)。
 *
 * 認証は provider token (JWT, ES256)。Apple Developer の APNs Auth Key (.p8) を 1 つ使い、
 * 全 device に共通の bearer を付ける。証明書ベースより運用が楽。
 *
 * 設定はすべて env (秘密の .p8 は path 渡し、ファイル本体は VPS 上に user が設置する):
 *   APNS_KEY_PATH   .p8 ファイルのパス (例 /var/lib/vigili/apns/AuthKey_ABC123.p8)
 *   APNS_KEY_ID     Key ID (10 文字、.p8 のファイル名にも入っている)
 *   APNS_TEAM_ID    Apple Developer Team ID (10 文字)
 *   APNS_TOPIC      アプリの bundle id (= io.vigili.mobile.shono)
 *   APNS_ENV        "sandbox" (Xcode development build / 既定) または "production"
 *
 * いずれか欠けると disabled (no-op) で起動する。未設定でも relay は普通に動く。
 */

import { type KeyObject, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { constants, type ClientHttp2Session, connect as http2Connect } from "node:http2";

export interface ApnsConfig {
  keyPath: string;
  keyId: string;
  teamId: string;
  topic: string;
  /** sandbox (= development build) か production か。 */
  env: "sandbox" | "production";
}

export interface ApnsNotification {
  title: string;
  body: string;
  /** 通知のグルーピング用 (同じ pairing/session でまとめる)。 */
  threadId?: string;
}

export interface ApnsSendResult {
  token: string;
  status: number;
  /** APNs が返す失敗理由 (例 "BadDeviceToken" / "Unregistered")。 */
  reason?: string;
  /** この token はもう無効 (410 Unregistered 等) なので store から消すべきか。 */
  unregistered: boolean;
}

export interface ApnsSender {
  readonly enabled: boolean;
  send(deviceToken: string, n: ApnsNotification): Promise<ApnsSendResult>;
  close(): void;
}

const DISABLED_SENDER: ApnsSender = {
  enabled: false,
  async send(token) {
    return { token, status: 0, reason: "apns_disabled", unregistered: false };
  },
  close() {
    /* no-op */
  },
};

/** env から設定を読む。欠けていれば null (= disabled)。 */
export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyPath = env.APNS_KEY_PATH?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const topic = env.APNS_TOPIC?.trim();
  if (!keyPath || !keyId || !teamId || !topic) return null;
  const rawEnv = (env.APNS_ENV ?? "sandbox").trim().toLowerCase();
  const apnsEnv = rawEnv === "production" || rawEnv === "prod" ? "production" : "sandbox";
  return { keyPath, keyId, teamId, topic, env: apnsEnv };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * provider token (JWT, ES256) を作る。`dsaEncoding: "ieee-p1363"` で DER ではなく
 * JOSE が要求する raw r||s 形式の署名を得る (これが無いと APNs が弾く)。
 */
export function buildProviderToken(
  privateKey: KeyObject,
  keyId: string,
  teamId: string,
  nowSec: number,
): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: nowSec }));
  const signingInput = `${header}.${payload}`;
  const sig = cryptoSign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(sig)}`;
}

/** APNs provider token は最大 1h 有効。余裕を見て 50 分でローテートする。 */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export function createApnsSender(
  config: ApnsConfig,
  log: (m: string) => void = () => {},
): ApnsSender {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: readFileSync(config.keyPath), format: "pem" });
  } catch (err) {
    log(`[apns] .p8 読み込み失敗 (${config.keyPath}): ${(err as Error).message} — disabled`);
    return DISABLED_SENDER;
  }

  const host = config.env === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const authority = `https://${host}`;

  let cachedToken = "";
  let cachedTokenAt = 0;
  function providerToken(): string {
    const now = Date.now();
    if (cachedToken && now - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;
    cachedToken = buildProviderToken(
      privateKey,
      config.keyId,
      config.teamId,
      Math.floor(now / 1000),
    );
    cachedTokenAt = now;
    return cachedToken;
  }

  let session: ClientHttp2Session | null = null;
  function getSession(): ClientHttp2Session {
    if (session && !session.closed && !session.destroyed) return session;
    const s = http2Connect(authority);
    s.on("error", (err) => log(`[apns] http2 session error: ${err.message}`));
    s.on("close", () => {
      if (session === s) session = null;
    });
    session = s;
    return s;
  }

  return {
    enabled: true,
    send(deviceToken, n) {
      return new Promise<ApnsSendResult>((resolve) => {
        let sess: ClientHttp2Session;
        try {
          sess = getSession();
        } catch (err) {
          resolve({
            token: deviceToken,
            status: 0,
            reason: (err as Error).message,
            unregistered: false,
          });
          return;
        }
        const payload = JSON.stringify({
          aps: {
            alert: { title: n.title, body: n.body },
            sound: "default",
            "interruption-level": "time-sensitive",
          },
        });
        const headers: Record<string, string> = {
          [constants.HTTP2_HEADER_METHOD]: "POST",
          [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
          [constants.HTTP2_HEADER_SCHEME]: "https",
          authorization: `bearer ${providerToken()}`,
          "apns-topic": config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
        };
        if (n.threadId) headers["apns-collapse-id"] = n.threadId.slice(0, 64);

        let status = 0;
        let bodyText = "";
        let settled = false;
        const finish = (result: ApnsSendResult): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        let req: ReturnType<ClientHttp2Session["request"]>;
        try {
          req = sess.request(headers);
        } catch (err) {
          finish({
            token: deviceToken,
            status: 0,
            reason: (err as Error).message,
            unregistered: false,
          });
          return;
        }
        req.setTimeout(10_000, () => {
          req.close(constants.NGHTTP2_CANCEL);
          finish({ token: deviceToken, status: 0, reason: "timeout", unregistered: false });
        });
        req.on("response", (h) => {
          status = Number(h[constants.HTTP2_HEADER_STATUS] ?? 0);
        });
        req.on("data", (chunk: Buffer) => {
          bodyText += chunk.toString("utf-8");
        });
        req.on("error", (err) => {
          finish({ token: deviceToken, status: 0, reason: err.message, unregistered: false });
        });
        req.on("end", () => {
          let reason: string | undefined;
          if (bodyText) {
            try {
              reason = (JSON.parse(bodyText) as { reason?: string }).reason;
            } catch {
              /* APNs は成功時 body 空 */
            }
          }
          // 410 = device 無効。400 + BadDeviceToken / Unregistered / DeviceTokenNotForTopic も実質失効。
          const unregistered =
            status === 410 ||
            reason === "Unregistered" ||
            reason === "BadDeviceToken" ||
            reason === "DeviceTokenNotForTopic";
          // exactOptionalPropertyTypes: reason は定義済みのときだけ載せる。
          const result: ApnsSendResult = { token: deviceToken, status, unregistered };
          if (reason !== undefined) result.reason = reason;
          finish(result);
        });
        req.end(payload);
      });
    },
    close() {
      try {
        session?.close();
      } catch {
        /* ignore */
      }
      session = null;
    },
  };
}

/** env から sender を組み立てる薄いヘルパ。未設定なら disabled。 */
export function createApnsSenderFromEnv(
  log: (m: string) => void = () => {},
  env: NodeJS.ProcessEnv = process.env,
): ApnsSender {
  const config = apnsConfigFromEnv(env);
  if (!config) {
    log("[apns] 未設定 (APNS_KEY_PATH/KEY_ID/TEAM_ID/TOPIC のいずれか欠如) — push 無効");
    return DISABLED_SENDER;
  }
  log(`[apns] enabled env=${config.env} topic=${config.topic} keyId=${config.keyId}`);
  return createApnsSender(config, log);
}
