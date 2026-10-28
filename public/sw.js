// The installed web shell. Same-origin GET responses are kept so the page can
// open again with no network. /api and anything that is not GET stay on the
// network, so a cached shell never replays a private response.
const CACHE = "sagax-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/app-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) await cache.put(event.request, fresh.clone());
      return fresh;
    } catch (error) {
      const cached = (await cache.match(event.request)) || (event.request.mode === "navigate" ? await cache.match("/index.html") : undefined);
      if (cached) return cached;
      throw error;
    }
  })());
});
