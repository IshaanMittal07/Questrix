/**
 * Browser side of push subscriptions (plan §7.1). Call subscribe() from a
 * click handler only: iOS Safari asks for permission only inside a tap.
 */

/** base64url → bytes, for PushManager's applicationServerKey. */
export function urlBase64ToUint8Array(
  base64url: string,
): Uint8Array<ArrayBuffer> {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "denied"
        | "dismissed"
        | "unavailable"
        | "too-many"
        | "rate-limited"
        | "failed";
    };

/** How long to wait for the service worker before giving up. */
export const READY_TIMEOUT_MS = 10_000;

async function post(method: "POST" | "DELETE", body: unknown) {
  return fetch("/api/push/subscribe", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    // Survives the page navigating away (sign-out submits right after).
    keepalive: true,
    // A redirect (to /login, say) is never success.
    redirect: "error",
  });
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return true; // Not exposed by this browser: assume it matches.
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * The active registration of /sw.js, or null if none becomes active in
 * time. `ready` never settles without a worker (dev builds, a failed
 * registration), so it's always raced against a timeout.
 */
export async function activeRegistration(
  timeoutMs = READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Ask for permission, subscribe this device, and save it on the server. */
export async function subscribe(
  publicKey: string | undefined,
): Promise<SubscribeResult> {
  if (!publicKey) return { ok: false, reason: "unavailable" };
  // The first await in the tap: browsers only prompt inside a user gesture.
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { ok: false, reason: "denied" };
  // "default": the prompt was dismissed, not blocked.
  if (permission !== "granted") return { ok: false, reason: "dismissed" };
  try {
    const reg = await activeRegistration();
    if (!reg) return { ok: false, reason: "unavailable" };
    const key = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // A subscription made for another VAPID key (a rotation) can't receive
    // our pushes: replace it.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    const res = await post("POST", sub.toJSON());
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { limit?: string };
      return {
        ok: false,
        reason: body.limit === "devices" ? "too-many" : "rate-limited",
      };
    }
    return res.ok ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Forget this device on the server, then unsubscribe it. The browser side
 * is unsubscribed even when the server can't be reached: the device must
 * stop receiving pushes either way (P1), and a row left behind is removed
 * by the sender's next 404/410. True only when both succeeded.
 */
export async function unsubscribe(): Promise<boolean> {
  let sub: PushSubscription | null;
  try {
    // No registration means no subscription to remove (and `ready` would
    // never settle).
    const reg = await navigator.serviceWorker.getRegistration();
    sub = (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return false;
  }
  if (!sub) return true;
  // Both at once, so a slow network can't leave either side behind when
  // sign-out gives up waiting. The DELETE is sent while the session is
  // still valid (P1) and survives the navigation (keepalive); it needs
  // only the endpoint, captured here.
  const { endpoint } = sub;
  const [server, browser] = await Promise.allSettled([
    post("DELETE", { endpoint }),
    sub.unsubscribe(),
  ]);
  const serverOk = server.status === "fulfilled" && server.value.ok;
  return serverOk && browser.status === "fulfilled";
}

/**
 * Re-save this device's subscription for whoever is signed in now. A
 * session can end without our sign-out (expiry, another device), leaving
 * the row with the previous user; the RPC moves it (P1). Best effort.
 */
export async function claimSubscription(): Promise<void> {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await post("POST", sub.toJSON());
  } catch {
    // Nothing to do: the toggle still reflects the browser's state.
  }
}

/** Is this device subscribed (and allowed) right now? */
export async function isSubscribed(): Promise<boolean> {
  try {
    if (Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
