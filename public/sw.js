/* IAG Finance PWA service worker — install shell + Web Push (iOS Home Screen + desktop) */
const CACHE = "iag-finance-shell-v6";
// Never cache the full Next HTML document: it embeds hashed chunk URLs that die
// on the next deploy and resurface as ChunkLoadError when served offline/stale.
const SHELL = ["/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first for app navigations; static offline page when offline.
  //
  // Do NOT cache successful HTML navigations — a year-old (or deploy-stale)
  // document still references `/_next/static/chunks/*` that no longer exist.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached =
          (await caches.match("/offline.html")) || (await caches.match(req));
        return (
          cached ||
          new Response("<h1>Offline</h1><p>Reconnect and try again.</p>", {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        );
      }),
    );
  }
});

function showPushNotification(data) {
  const title = (data && data.title) || "IAG Finance";
  const options = {
    body: (data && data.body) || "You have an update",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: (data && data.tag) || "iag-finance",
    renotify: true,
    data: { url: (data && data.url) || "/" },
    // Keep approval banners until the user acts (ignored on some iOS builds — fine).
    requireInteraction: Boolean(
      data && /test|approval|request|needed/i.test(String(data.tag || "") + String(data.title || "")),
    ),
  };
  return self.registration.showNotification(title, options).catch(() =>
    self.registration.showNotification(title, {
      body: options.body,
      tag: options.tag,
      data: options.data,
    }),
  );
}

self.addEventListener("push", (event) => {
  let data = { title: "IAG Finance", body: "Approval update", url: "/", tag: "iag" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      const text = event.data ? event.data.text() : "";
      if (text) data.body = text;
    } catch {
      /* ignore */
    }
  }
  // Always show a notification — required for reliable iOS delivery.
  event.waitUntil(showPushNotification(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client && typeof client.navigate === "function") {
            return client.navigate(target).then((c) => (c && c.focus ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});

// iOS sometimes drops silent push; keep SW alive for subscription changes.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const reg = await self.registration;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        // Client will re-POST on next focus via refreshPushSubscriptionQuietly.
      } catch {
        /* ignore */
      }
    })(),
  );
});
