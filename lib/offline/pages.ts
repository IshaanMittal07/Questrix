/**
 * The service worker keeps the last Today page in this cache so it can be
 * viewed offline (public/sw.js, DECISIONS H11). It holds the user's own data,
 * so sign-out and account deletion clear it: on a shared device the next
 * person can't open the app offline and see it.
 */
export const PAGES_CACHE = "questrix-pages";

/** Never throws, and never takes long enough to hold up sign-out. */
export async function clearOfflinePages(timeoutMs = 1000): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await Promise.race([
      caches.delete(PAGES_CACHE),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  } catch {
    // Storage blocked (private mode): nothing was cached either.
  }
}
