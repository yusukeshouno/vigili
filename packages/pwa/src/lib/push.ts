"use client";

/**
 * Web Push (W3C Push API) のクライアント側ヘルパ。
 *
 * 流れ:
 *  1. enableNativePush(): Notification.requestPermission → SW 取得 → /push/vapid-public-key 取得
 *     → pushManager.subscribe → POST /push/subscriptions
 *  2. disableNativePush(): subscription.unsubscribe + DELETE /push/subscriptions
 *
 * iOS Safari は「ホーム画面に追加した PWA」でしか push を受信できないので、
 * 事前に isStandaloneRequired() で確認すること。
 */

import { type PwaConfig, loadConfig } from "./config-store";

export interface PushStatus {
  /** ブラウザが Web Push をサポートしているか */
  supported: boolean;
  /** PWA がホーム画面起動 (standalone) か */
  standalone: boolean;
  /** iOS で「ホーム画面追加が必要」と判定された場合 true */
  needsHomeScreen: boolean;
  /** Notification.permission */
  permission: NotificationPermission | "unknown";
  /** 現在 subscribe されているか */
  subscribed: boolean;
  /** 現在 subscribe している場合の endpoint (デバッグ表示用) */
  endpoint?: string;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined") {
    return {
      supported: false,
      standalone: false,
      needsHomeScreen: false,
      permission: "unknown",
      subscribed: false,
    };
  }
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  const isIos = /iPad|iPhone|iPod/u.test(window.navigator.userAgent);
  const needsHomeScreen = isIos && !standalone;
  const permission: NotificationPermission = supported ? Notification.permission : "default";

  let subscribed = false;
  let endpoint: string | undefined;
  if (supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        subscribed = true;
        endpoint = sub.endpoint;
      }
    } catch {
      // ignore
    }
  }
  return {
    supported,
    standalone,
    needsHomeScreen,
    permission,
    subscribed,
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
}

export class PushSetupError extends Error {
  constructor(message: string, readonly kind: PushSetupErrorKind) {
    super(message);
    this.name = "PushSetupError";
  }
}

export type PushSetupErrorKind =
  | "not-supported"
  | "needs-home-screen"
  | "permission-denied"
  | "no-config"
  | "vapid-fetch-failed"
  | "subscribe-failed"
  | "register-failed";

/**
 * subscribe を一気通貫で行う。
 *
 * 戻り値はサーバ登録後の subscription endpoint。失敗時は PushSetupError。
 */
export async function enableNativePush(): Promise<string> {
  if (typeof window === "undefined") {
    throw new PushSetupError("SSR で呼ばれました", "not-supported");
  }

  // iOS Safari の罠回避: Notification.requestPermission() は user gesture から
  // **同期的に**呼ぶ必要がある。先に await を挟むと iOS は user gesture を失効と
  // 見なし、ダイアログを表示せず黙って "default" を返してくる。
  // よって supported/standalone のチェックは同期 API だけで先に済ませ、
  // requestPermission をまっさきに呼ぶ。
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new PushSetupError("このブラウザは Web Push 非対応です", "not-supported");
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  const isIos = /iPad|iPhone|iPod/u.test(window.navigator.userAgent);
  if (isIos && !standalone) {
    throw new PushSetupError(
      "iOS では先に「共有 → ホーム画面に追加」してから、追加した PWA から再度お試しください",
      "needs-home-screen",
    );
  }

  // requestPermission を await の先頭で同期 path から呼ぶ。
  // すでに granted の場合は即座に解決するので問題ない。
  let perm: NotificationPermission;
  try {
    perm = await Notification.requestPermission();
  } catch (err) {
    throw new PushSetupError(
      `通知許可の要求に失敗: ${(err as Error).message}`,
      "permission-denied",
    );
  }
  if (perm === "default") {
    // iOS Safari は user gesture を失った時にダイアログを出さず default を返してくる
    throw new PushSetupError(
      "iOS が通知ダイアログを表示しませんでした。一度 PWA を完全に閉じ、ホーム画面のアイコンから再起動してから直接 Enable をタップしてください (途中で他の画面に切り替えると user gesture が失効します)",
      "permission-denied",
    );
  }
  if (perm !== "granted") {
    throw new PushSetupError("通知許可が拒否されました", "permission-denied");
  }

  // ここまで来たら user gesture は不要。後続の async は順に進めて良い。
  const config = await loadConfig();
  if (!config) {
    throw new PushSetupError("daemon URL / token が未設定です (/setup で先に登録)", "no-config");
  }

  // SW が無ければ作る (本番では layout が登録するが、開発時のフォールバック)
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  } catch (err) {
    throw new PushSetupError(
      `SW 登録失敗: ${(err as Error).message}`,
      "register-failed",
    );
  }
  // SW が active になるまで待つ。subscribe は active 状態が必要。
  await navigator.serviceWorker.ready;

  // 公開鍵を daemon から取る
  let publicKey: string;
  try {
    const res = await fetch(joinUrl(config.daemonUrl, "/push/vapid-public-key"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { publicKey: string };
    publicKey = json.publicKey;
  } catch (err) {
    throw new PushSetupError(
      `VAPID 公開鍵の取得に失敗: ${(err as Error).message}`,
      "vapid-fetch-failed",
    );
  }

  // subscribe
  let sub: PushSubscription;
  try {
    // applicationServerKey は BufferSource を要求。Uint8Array の .buffer を渡す。
    const keyBuffer = urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBuffer,
    });
  } catch (err) {
    throw new PushSetupError(
      `subscribe 失敗: ${(err as Error).message}`,
      "subscribe-failed",
    );
  }

  // daemon に登録
  const subJson = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh: string; auth: string };
  };
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    throw new PushSetupError(
      "subscription に endpoint / keys がありません (古いブラウザ?)",
      "subscribe-failed",
    );
  }
  try {
    const res = await fetch(joinUrl(config.daemonUrl, "/push/subscriptions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });
    if (!res.ok) {
      throw new Error(`daemon が ${res.status} を返しました`);
    }
  } catch (err) {
    // サーバ登録に失敗したら subscribe を巻き戻す (片肺状態を避ける)
    try {
      await sub.unsubscribe();
    } catch {
      // ignore
    }
    throw new PushSetupError(
      `daemon への subscription 登録失敗: ${(err as Error).message}`,
      "register-failed",
    );
  }
  return subJson.endpoint;
}

/** subscribe を解除する。成功すれば true。 */
export async function disableNativePush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  const endpoint = sub.endpoint;
  const config = await loadConfig();
  // ローカル側を先に解除 (失敗しても続行)
  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }
  if (config) {
    try {
      await fetch(joinUrl(config.daemonUrl, "/push/subscriptions"), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      // サーバ側削除に失敗しても 410 で次回 prune される
    }
  }
  return true;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/u, "");
  return `${b}${path}`;
}

/**
 * VAPID 公開鍵 (base64url) を Uint8Array に変換する。
 * PushManager.subscribe の applicationServerKey 要件: ArrayBuffer または Uint8Array。
 */
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  // base64url → base64
  const padded = base64url + "===".slice((base64url.length + 3) % 4);
  const base64 = padded.replace(/-/gu, "+").replace(/_/gu, "/");
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// 型を export しておくと PwaConfig を import せずに済む UI もある。
export type { PwaConfig };
