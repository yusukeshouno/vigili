// Vigili Service Worker.
// 目的:
//  - インストール時に app shell をプリキャッシュ (オフラインで開ける)
//  - HTML/CSS/JS リクエストには「Network-first, fallback to cache」
//  - その他 (icon, manifest) は「Cache-first」
//  - Web Push 受信: push event で daemon からの payload を showNotification
//  - notificationclick: payload.data.url (例: /r/<id>) を開く

const VERSION = "sentinel-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // /ws (WebSocket upgrade) や _next の HMR は通過させる
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/ws")) return;

  const isDoc = req.mode === "navigate" || req.destination === "document";
  if (isDoc) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(VERSION);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    // navigation の最終 fallback: ルート
    const root = await caches.match("/");
    if (root) return root;
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(VERSION);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}

// Web Push の受信ハンドラ。
// daemon の WebPushNotifier が JSON 文字列を送ってくる:
//   { title, body, tag, url, level }
// payload が無い (= keepalive) 場合はジェネリックなタイトルで表示する。
self.addEventListener("push", (event) => {
  let payload = { title: "Vigili", body: "新しい承認", level: "normal", url: "/" };
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      // テキスト fallback (daemon は JSON しか送らないが念のため)
      try {
        payload.body = event.data.text();
      } catch {
        // ignore
      }
    }
  }
  const requireInteraction = payload.level === "critical";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      requireInteraction,
      // iOS の PWA 通知は icon/badge を独自表示しないが、Android/Desktop 用に指定
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.navigate?.(target);
      } else {
        await self.clients.openWindow(target);
      }
    })(),
  );
});
