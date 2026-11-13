/* Questrix service worker (plan §3, §7.1).
 * Phase 1: offline fallback for page navigations only.
 * Push + notificationclick handlers arrive in Phase 5.
 */
const CACHE = "questrix-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigations; fall back to the offline page when offline.
// Precached static assets (the offline page's icon) are served cache-first.
// Never cache API calls or completions — the server is authoritative.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    PRECACHE.includes(url.pathname) &&
    event.request.mode !== "navigate"
  ) {
    event.respondWith(
      caches.match(url.pathname).then((res) => res || fetch(event.request)),
    );
    return;
  }
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((res) => res || Response.error()),
    ),
  );
});
