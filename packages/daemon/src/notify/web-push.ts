import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ApprovalRequest, PushPayload, PushSubscriptionJson } from "@vigili/shared";
import webpush from "web-push";
import type { Notifier, NotifyInput } from "./types.js";

/**
 * Web Push (W3C Push API) ベースの通知経路。
 *
 * - VAPID 鍵は ~/.sentinel/vapid.json に永続化 (無ければ初回起動時に生成)
 * - PushSubscription は ~/.sentinel/push-subs.json に永続化
 * - daemon は web-push ライブラリで Apple/Mozilla/Google の push service に POST する
 * - 410 Gone / 404 Not Found が返ったら自動で subscription を削除する (= unsubscribe された)
 *
 * 第三者サーバ (ntfy.sh 等) を経由しない、もっとも「ネイティブ」に近い経路。
 */

export interface VapidKeys {
  publicKey: string; // base64url
  privateKey: string; // base64url
  /** Apple/Mozilla の push service が要求する連絡先。mailto: または https:// */
  subject: string;
}

/**
 * VAPID 鍵を読み込む。無ければ生成して保存する。
 *
 * subject は Push サービス運営側へのデバッグ連絡先 (RFC 8292)。
 * 本人専用 daemon なので mailto: は架空でも動くが、Apple Push Service は
 * きちんとした URL/メールでないと 400 を返すことがあるため "mailto:sentinel@localhost"
 * のような有効な形式を必ず入れる。
 */
export function loadOrCreateVapidKeys(path: string, subject: string): VapidKeys {
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<VapidKeys>;
      if (parsed.publicKey && parsed.privateKey) {
        return {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          subject: parsed.subject ?? subject,
        };
      }
    } catch {
      // ファイル破損時は再生成
    }
  }
  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  mkdirSync(dirname(path), { recursive: true });
  // 0600 (本人のみ読み書き)
  writeFileSync(path, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

// ---------------------------------------------------------------------------
// Subscription store: ~/.sentinel/push-subs.json (JSON 配列、atomic write)
// ---------------------------------------------------------------------------

export interface StoredSubscription extends PushSubscriptionJson {
  /** PWA が subscribe した時刻 (ms)。古い subscription を判別するため。 */
  created_at: number;
  /** UA 文字列 (Settings 画面で「どの端末か」を表示するため。任意)。 */
  user_agent?: string;
}

export interface SubscriptionStore {
  list(): StoredSubscription[];
  /** endpoint 重複は上書き (= 再 subscribe 時の重複防止)。 */
  add(sub: StoredSubscription): void;
  /** 見つかれば true、無ければ false。 */
  remove(endpoint: string): boolean;
  size(): number;
}

export function openSubscriptionStore(path: string): SubscriptionStore {
  let cache: StoredSubscription[] = loadFromDisk(path);

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true });
    // atomic write: tmp → rename
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  }

  return {
    list() {
      return cache.slice();
    },
    add(sub) {
      cache = cache.filter((s) => s.endpoint !== sub.endpoint);
      cache.push(sub);
      persist();
    },
    remove(endpoint) {
      const before = cache.length;
      cache = cache.filter((s) => s.endpoint !== endpoint);
      const removed = cache.length !== before;
      if (removed) persist();
      return removed;
    },
    size() {
      return cache.length;
    },
  };
}

function loadFromDisk(path: string): StoredSubscription[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 最低限の形チェック (ランタイムバリデーション過剰回避)
    return parsed.filter(
      (s): s is StoredSubscription =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { endpoint?: unknown }).endpoint === "string",
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Notifier 実装
// ---------------------------------------------------------------------------

/**
 * web-push.sendNotification の最小型。テストで差し替え可能にするため interface 化。
 *
 * subscription は endpoint + keys だけで十分 (web-push の型は expirationTime を要求するが
 * 実際の呼び出しでは不要なので、必須フィールドだけに狭めている)。
 */
export interface WebPushSubscriptionLike {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type WebPushSender = (
  subscription: WebPushSubscriptionLike,
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    urgency: "very-low" | "low" | "normal" | "high";
    topic?: string;
  },
) => Promise<{ statusCode: number }>;

export interface WebPushNotifierOptions {
  vapid: VapidKeys;
  store: SubscriptionStore;
  /** PWA の公開 URL。タップ後の遷移先 /r/<id> を組み立てるのに使う。無ければ "/r/<id>"。 */
  pwaBaseUrl?: string;
  log?: (msg: string) => void;
  sender?: WebPushSender;
}

export function createWebPushNotifier(opts: WebPushNotifierOptions): Notifier {
  const log = opts.log ?? ((m) => console.error(m));
  const send: WebPushSender = opts.sender ?? defaultSender;

  return {
    async notify(input) {
      const subs = opts.store.list();
      if (subs.length === 0) {
        log("[vigili-push] subscription 無し → スキップ");
        return;
      }
      const payload = buildPayload(input, opts.pwaBaseUrl);
      const payloadJson = JSON.stringify(payload);
      const urgency = input.level === "critical" ? "high" : "normal";

      const results = await Promise.allSettled(
        subs.map(async (sub) => {
          try {
            const res = await send(
              { endpoint: sub.endpoint, keys: sub.keys },
              payloadJson,
              {
                vapidDetails: {
                  subject: opts.vapid.subject,
                  publicKey: opts.vapid.publicKey,
                  privateKey: opts.vapid.privateKey,
                },
                TTL: 300, // 5 分。承認応答は短時間で意味を失う
                urgency,
                topic: input.request.id.slice(0, 32), // 同一 request の通知を coalesce
              },
            );
            return { endpoint: sub.endpoint, statusCode: res.statusCode };
          } catch (err) {
            // web-push は WebPushError を throw する。statusCode を持つ。
            const e = err as { statusCode?: number; body?: string; message?: string };
            return {
              endpoint: sub.endpoint,
              statusCode: e.statusCode ?? 0,
              error: e.message ?? "unknown",
              body: e.body,
            };
          }
        }),
      );

      for (const r of results) {
        if (r.status === "rejected") {
          log(`[vigili-push] 予期せぬ rejection: ${String(r.reason)}`);
          continue;
        }
        const v = r.value as {
          endpoint: string;
          statusCode: number;
          error?: string;
          body?: string;
        };
        if (v.statusCode === 410 || v.statusCode === 404) {
          // Gone / Not Found → 端末が unsubscribe 済み。store から除去。
          opts.store.remove(v.endpoint);
          log(`[vigili-push] subscription gone (${v.statusCode}) → 削除: ${truncEnd(v.endpoint)}`);
        } else if (v.statusCode >= 200 && v.statusCode < 300) {
          log(`[vigili-push] ok ${v.statusCode} → ${truncEnd(v.endpoint)}`);
        } else {
          log(
            `[vigili-push] 失敗 ${v.statusCode} ${v.error ?? ""} body=${v.body ?? ""} → ${truncEnd(v.endpoint)}`,
          );
        }
      }
    },
  };
}

const defaultSender: WebPushSender = (subscription, payload, options) =>
  webpush.sendNotification(
    // web-push の型 PushSubscription は expirationTime: number | null を要求するが
    // sendNotification 内部では endpoint と keys しか使わない。as キャストで
    // exactOptionalPropertyTypes の差分を回避する。
    subscription as unknown as Parameters<typeof webpush.sendNotification>[0],
    payload,
    options,
  ) as Promise<{ statusCode: number }>;

/** push payload を組み立てる。SW がそのまま showNotification に流す。 */
export function buildPayload(input: NotifyInput, pwaBaseUrl?: string): PushPayload {
  const r = input.request;
  const tag = r.session_tag ?? "?";
  const title = `Vigili — ${input.ruleSource}`;
  const body = describeRequest(r);
  const base = (pwaBaseUrl ?? "").replace(/\/$/u, "");
  const url = base !== "" ? `${base}/r/${r.id}` : `/r/${r.id}`;
  return {
    title: `[${tag}] ${title}`,
    body,
    tag: r.id, // 同一 request の通知が来たら後勝ちで上書き
    url,
    level: input.level,
  };
}

function describeRequest(req: ApprovalRequest): string {
  if (req.tool_name === "Bash") {
    const cmd = stringField(req.tool_input, "command");
    return `$ ${truncate(cmd ?? "(no command)", 200)}`;
  }
  if (req.tool_name === "Edit" || req.tool_name === "Write") {
    const p = stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path");
    return `${req.tool_name} ${truncate(p ?? "(no path)", 200)}`;
  }
  if (req.tool_name === "WebFetch") {
    const u = stringField(req.tool_input, "url");
    return `WebFetch ${truncate(u ?? "(no url)", 200)}`;
  }
  return `${req.tool_name} ${truncate(JSON.stringify(req.tool_input), 200)}`;
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function truncEnd(s: string): string {
  return s.length <= 60 ? s : `…${s.slice(s.length - 60)}`;
}
