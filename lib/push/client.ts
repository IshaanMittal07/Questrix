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
  | { ok: false; reason: "denied" | "unavailable" | "too-many" | "failed" };

async function post(method: "POST" | "DELETE", body: unknown) {
  return fetch("/api/push/subscribe", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return true; // Not exposed by this browser: assume it matches.
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** The registration that /sw.js is (or will be) running. */
async function registration() {
  return navigator.serviceWorker.ready;
}

/** Ask for permission, subscribe this device, and save it on the server. */
export async function subscribe(
  publicKey: string | undefined,
): Promise<SubscribeResult> {
  if (!publicKey) return { ok: false, reason: "unavailable" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  try {
    const reg = await registration();
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
    if (res.status === 429) return { ok: false, reason: "too-many" };
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
    const reg = await registration();
    sub = await reg.pushManager.getSubscription();
  } catch {
    return false;
  }
  if (!sub) return true;
  let serverOk = false;
  try {
    // Server first, while the session is still valid (P1).
    const res = await post("DELETE", { endpoint: sub.endpoint });
    serverOk = res.ok;
  } catch {
    serverOk = false;
  }
  try {
    await sub.unsubscribe();
  } catch {
    return false;
  }
  return serverOk;
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
