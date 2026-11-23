/* Questrix service worker (plan §3, §7.1).
 * Phase 1: offline fallback for page navigations.
 * Phase 5: push notifications and notification clicks (DECISIONS P8, #91).
 */
const CACHE = "questrix-v3";
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

// ── Push ─────────────────────────────────────────────────────────────────────
// The payload is JSON {title, body, url, tag} from /api/cron/reminders. It's
// rendered only as notification text, never as HTML. Anything unreadable
// falls back to a generic reminder, so a bad payload still shows something
// (a push must show a notification: userVisibleOnly).
const FALLBACK = {
  title: "Questrix",
  body: "You have a habit waiting.",
  url: "/today",
  tag: "questrix",
};
const TAG = /^(habit-[A-Za-z0-9-]{1,64}|streak-saver|questrix)$/;

// Trimmed, and cut by code point so an emoji is never split in half.
function text(value, fallback, max) {
  const t = typeof value === "string" ? value.trim() : "";
  return t ? Array.from(t).slice(0, max).join("") : fallback;
}

/** A same-origin path, or /today: never open another site from a click. */
function safeUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  ) {
    return "/today";
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/today";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/today";
  }
}

function readPayload(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (!data || typeof data !== "object") data = {};
  return {
    title: text(data.title, FALLBACK.title, 120),
    body: text(data.body, FALLBACK.body, 300),
    url: safeUrl(data.url),
    tag:
      typeof data.tag === "string" && TAG.test(data.tag)
        ? data.tag
        : FALLBACK.tag,
  };
}

self.addEventListener("push", (event) => {
  const p = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: p.tag,
      data: { url: p.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const own = windows.find(
          (w) => new URL(w.url).origin === self.location.origin,
        );
        // navigate() only works on a window this worker controls (a tab
        // opened before it activated isn't); open a new one instead.
        if (own) {
          return own
            .focus()
            .then((w) => (w && "navigate" in w ? w.navigate(url) : w))
            .catch(() => self.clients.openWindow(url));
        }
        return self.clients.openWindow(url);
      }),
  );
});
