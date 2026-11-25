/* Questrix service worker (plan §3, §7.1).
 * Phase 1: offline fallback for page navigations.
 * After v1: Today viewable offline from its last copy (plan §9).
 * Phase 5: push notifications and notification clicks (DECISIONS P8, #91).
 */
const CACHE = "questrix-v4";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];
// The last Today page loaded online, for viewing offline (plan §9). Cleared
// on sign-out and account deletion by the page, and dropped here whenever
// /today redirects (signed out or not onboarded).
const PAGES = "questrix-pages";
const PAGE_PATHS = ["/today"];
// Hashed build assets the cached page needs (CSS, JS, fonts): immutable, so
// cache-first. Trimmed to the newest STATIC_MAX entries.
const STATIC = "questrix-static";
const STATIC_MAX = 200;
const KEEP = [CACHE, PAGES, STATIC];

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
          keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimStatic(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .slice(0, Math.max(0, keys.length - STATIC_MAX))
      .map((k) => cache.delete(k)),
  );
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    await trimStatic(cache);
  }
  return res;
}

/** Network-first; keeps Today's last good copy; offline falls back to it. */
async function navigate(request, path) {
  const keep = PAGE_PATHS.includes(path);
  try {
    const res = await fetch(request);
    if (keep) {
      const cache = await caches.open(PAGES);
      // Only a real, signed-in Today: a redirect means the session is gone.
      if (res.ok && !res.redirected && res.type === "basic") {
        await cache.put(path, res.clone());
      } else if (res.redirected) {
        await cache.delete(path);
      }
    }
    return res;
  } catch {
    const page = keep ? await caches.match(path, { cacheName: PAGES }) : null;
    return page || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

// Network-first for navigations: Today falls back to its last copy, other
// pages to the offline page. Precached and hashed static assets are
// cache-first. Never cache API calls, Server Actions or completions: the
// server is authoritative, and nothing is queued offline.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  if (PRECACHE.includes(url.pathname) && event.request.mode !== "navigate") {
    event.respondWith(
      caches.match(url.pathname).then((res) => res || fetch(event.request)),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(event.request));
    return;
  }
  if (event.request.mode !== "navigate") return;
  event.respondWith(navigate(event.request, url.pathname));
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
    const out = url.pathname + url.search + url.hash;
    // Check the output too: dot segments can turn "/..//evil.com" (same
    // origin as input) into the protocol-relative "//evil.com", which a
    // window would open as another site (security audit of PR #99, B1).
    if (!out.startsWith("/") || out.startsWith("//")) return "/today";
    return out;
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
