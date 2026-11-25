import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimSubscription,
  isSubscribed,
  subscribe,
  unsubscribe,
  urlBase64ToUint8Array,
} from "@/lib/push/client";

/** A real-looking VAPID public key: 65 bytes, base64url without padding. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
const toB64Url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const KEY = toB64Url(KEY_BYTES);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/dev1";

const calls: string[] = [];

function fakeSub(serverKey: ArrayBuffer | null, endpoint = ENDPOINT) {
  return {
    endpoint,
    options: { applicationServerKey: serverKey },
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => {
      calls.push("sub.unsubscribe");
      return true;
    }),
  };
}

type Sub = ReturnType<typeof fakeSub>;

let current: Sub | null;
let fresh: Sub;
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn<(opts: unknown) => Promise<Sub>>(async () => {
    calls.push("pm.subscribe");
    return fresh;
  }),
};
const requestPermission = vi.fn(
  async () => "granted" as NotificationPermission,
);
let permission: NotificationPermission = "default";
let status = 200;
let body = "{}";
const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  calls.push(`fetch ${init.method}`);
  return new Response(body, { status });
});

beforeEach(() => {
  calls.length = 0;
  current = null;
  fresh = fakeSub(KEY_BYTES.slice().buffer);
  status = 200;
  body = "{}";
  permission = "default";
  pushManager.getSubscription.mockClear();
  pushManager.subscribe.mockClear();
  requestPermission.mockReset();
  requestPermission.mockResolvedValue("granted");
  fetchMock.mockClear();
  vi.stubGlobal("Notification", {
    requestPermission,
    get permission() {
      return permission;
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager }),
      getRegistration: vi.fn(async () => ({ pushManager })),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- remove the test double from jsdom's navigator.
  delete navigator.serviceWorker;
});

describe("urlBase64ToUint8Array", () => {
  it("round-trips a 65-byte VAPID key", () => {
    expect(Array.from(urlBase64ToUint8Array(KEY))).toEqual(
      Array.from(KEY_BYTES),
    );
  });

  it.each([0, 1, 2, 3, 4, 5, 31, 32, 33])(
    "round-trips %i bytes (every padding length)",
    (n) => {
      const bytes = Uint8Array.from({ length: n }, (_, i) => 255 - i);
      expect(Array.from(urlBase64ToUint8Array(toB64Url(bytes)))).toEqual(
        Array.from(bytes),
      );
    },
  );

  it("decodes the url-safe alphabet (- and _)", () => {
    // 0xfb 0xff 0xbf is "+/+/" in standard base64.
    expect(Array.from(urlBase64ToUint8Array("-_-_"))).toEqual([
      0xfb, 0xff, 0xbf,
    ]);
  });

  it("returns a Uint8Array backed by its own ArrayBuffer", () => {
    const out = urlBase64ToUint8Array(KEY);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.byteLength).toBe(65);
  });
});

describe("subscribe", () => {
  it("is unavailable without a public key and never asks for permission", async () => {
    expect(await subscribe(undefined)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await subscribe("")).toEqual({ ok: false, reason: "unavailable" });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["denied", "denied"],
    // A dismissed prompt isn't a block (review of PR #99).
    ["default", "dismissed"],
  ] as const)(
    "reports %s permission as %s, without subscribing",
    async (answer, reason) => {
      requestPermission.mockResolvedValue(answer);
      expect(await subscribe(KEY)).toEqual({ ok: false, reason });
      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("never follows a redirect (a signed-out call bounced to /login)", async () => {
    await subscribe(KEY);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      keepalive: true,
    });
  });

  it("reports unavailable when the service worker never becomes active", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(navigator.serviceWorker, "ready", {
        configurable: true,
        get: () => new Promise(() => {}),
      });
      const p = subscribe(KEY);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await p).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for permission, subscribes with the key and saves it", async () => {
    expect(await subscribe(KEY)).toEqual({ ok: true });
    expect(requestPermission).toHaveBeenCalledOnce();
    const opts = pushManager.subscribe.mock.calls[0][0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey)).toEqual(
      Array.from(KEY_BYTES),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push/subscribe");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual(fresh.toJSON());
  });

  it("reuses an existing subscription made with the same key", async () => {
    current = fakeSub(KEY_BYTES.slice().buffer);
    expect(await subscribe(KEY)).toEqual({ ok: true });
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls).toEqual(["fetch POST"]);
  });

  it("reuses an existing subscription when the browser hides its key", async () => {
    current = fakeSub(null);
    expect(await subscribe(KEY)).toEqual({ ok: true });
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("re-subscribes when the VAPID key changed (rotation)", async () => {
    const other = KEY_BYTES.slice();
    other[10] ^= 0xff;
    const old = fakeSub(
      other.buffer,
      "https://fcm.googleapis.com/fcm/send/old",
    );
    current = old;
    expect(await subscribe(KEY)).toEqual({ ok: true });
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(calls).toEqual(["sub.unsubscribe", "pm.subscribe", "fetch POST"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.endpoint).toBe(ENDPOINT);
  });

  it("re-subscribes when the stored key has a different length", async () => {
    const old = fakeSub(KEY_BYTES.slice(0, 64).buffer);
    current = old;
    await subscribe(KEY);
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("reports too-many for a 429 on the device cap", async () => {
    status = 429;
    body = JSON.stringify({ limit: "devices" });
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "too-many" });
  });

  it("reports rate-limited for any other 429", async () => {
    status = 429;
    body = JSON.stringify({ limit: "rate" });
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "rate-limited" });
    body = "not json";
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "rate-limited" });
  });

  it.each([400, 401, 403, 500])("reports failed for a %i", async (s) => {
    status = s;
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "failed" });
  });

  it("reports failed when the push service refuses", async () => {
    pushManager.subscribe.mockRejectedValueOnce(new Error("AbortError"));
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports failed when the network is down", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await subscribe(KEY)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("unsubscribe", () => {
  it("is a no-op success when there is no subscription", async () => {
    expect(await unsubscribe()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes on the server before unsubscribing the browser", async () => {
    current = fakeSub(KEY_BYTES.slice().buffer);
    expect(await unsubscribe()).toBe(true);
    expect(calls).toEqual(["fetch DELETE", "sub.unsubscribe"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push/subscribe");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: ENDPOINT });
  });

  it.each([401, 403, 500])(
    "still unsubscribes the browser when the DELETE returns %i, and reports false",
    async (s) => {
      current = fakeSub(KEY_BYTES.slice().buffer);
      status = s;
      expect(await unsubscribe()).toBe(false);
      expect(calls).toEqual(["fetch DELETE", "sub.unsubscribe"]);
    },
  );

  it("still unsubscribes the browser when the DELETE fetch throws (offline)", async () => {
    current = fakeSub(KEY_BYTES.slice().buffer);
    fetchMock.mockImplementationOnce(async () => {
      calls.push("fetch DELETE");
      throw new TypeError("Failed to fetch");
    });
    expect(await unsubscribe()).toBe(false);
    expect(current.unsubscribe).toHaveBeenCalledOnce();
    expect(calls).toEqual(["fetch DELETE", "sub.unsubscribe"]);
  });

  it("returns false when sub.unsubscribe throws after a good DELETE", async () => {
    current = fakeSub(KEY_BYTES.slice().buffer);
    current.unsubscribe.mockRejectedValueOnce(new Error("boom"));
    expect(await unsubscribe()).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns false when both the DELETE and sub.unsubscribe throw", async () => {
    current = fakeSub(KEY_BYTES.slice().buffer);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    current.unsubscribe.mockRejectedValueOnce(new Error("boom"));
    await expect(unsubscribe()).resolves.toBe(false);
  });

  it("returns false without a DELETE when getSubscription throws", async () => {
    pushManager.getSubscription.mockRejectedValueOnce(new Error("x"));
    expect(await unsubscribe()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isSubscribed", () => {
  it("is false without granted permission, even with a subscription", async () => {
    current = fakeSub(null);
    permission = "denied";
    expect(await isSubscribed()).toBe(false);
  });

  it("is true with permission and a subscription", async () => {
    current = fakeSub(null);
    permission = "granted";
    expect(await isSubscribed()).toBe(true);
  });

  it("is false with permission but no subscription", async () => {
    permission = "granted";
    expect(await isSubscribed()).toBe(false);
  });

  it("is false with no registration", async () => {
    permission = "granted";
    (
      navigator.serviceWorker.getRegistration as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(undefined);
    expect(await isSubscribed()).toBe(false);
  });

  it("is false when getSubscription throws", async () => {
    permission = "granted";
    pushManager.getSubscription.mockRejectedValueOnce(new Error("x"));
    expect(await isSubscribed()).toBe(false);
  });
});

describe("claimSubscription", () => {
  const getRegistration = () =>
    navigator.serviceWorker.getRegistration as ReturnType<typeof vi.fn>;

  it.each(["default", "denied"] as const)(
    "is none without granted permission (%s), even with a subscription",
    async (p) => {
      permission = p;
      current = fakeSub(KEY_BYTES.slice().buffer);
      expect(await claimSubscription(KEY)).toBe("none");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("is none with permission but no subscription", async () => {
    permission = "granted";
    expect(await claimSubscription(KEY)).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is none with no registration", async () => {
    permission = "granted";
    getRegistration().mockResolvedValueOnce(undefined);
    expect(await claimSubscription(KEY)).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-saves a subscription for the current key and reports ok", async () => {
    permission = "granted";
    current = fakeSub(KEY_BYTES.slice().buffer);
    expect(await claimSubscription(KEY)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push/subscribe");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "same-origin",
    });
    expect(JSON.parse(init.body as string)).toEqual(current.toJSON());
    // Claiming never touches the browser subscription.
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("re-saves when the browser hides the subscription's key", async () => {
    permission = "granted";
    current = fakeSub(null);
    expect(await claimSubscription(KEY)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "a different key",
      () => {
        const other = KEY_BYTES.slice();
        other[0] ^= 0x01;
        return other.buffer;
      },
    ],
    ["a shorter key", () => KEY_BYTES.slice(0, 64).buffer],
  ])(
    "is stale for %s, with no POST and no unsubscribe",
    async (_label, key) => {
      permission = "granted";
      current = fakeSub(key());
      expect(await claimSubscription(KEY)).toBe("stale");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(current.unsubscribe).not.toHaveBeenCalled();
      expect(pushManager.subscribe).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 429, 500])(
    "is failed for a %i from the POST",
    async (s) => {
      permission = "granted";
      current = fakeSub(KEY_BYTES.slice().buffer);
      status = s;
      expect(await claimSubscription(KEY)).toBe("failed");
    },
  );

  it("is failed when the POST throws", async () => {
    permission = "granted";
    current = fakeSub(KEY_BYTES.slice().buffer);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await claimSubscription(KEY)).toBe("failed");
  });

  it("is failed when getSubscription throws", async () => {
    permission = "granted";
    pushManager.getSubscription.mockRejectedValueOnce(new Error("x"));
    expect(await claimSubscription(KEY)).toBe("failed");
  });

  it.each([undefined, ""])(
    "is failed with a subscription but no public key (%j), without a POST",
    async (key) => {
      permission = "granted";
      current = fakeSub(KEY_BYTES.slice().buffer);
      expect(await claimSubscription(key)).toBe("failed");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("is none without a subscription even when the key is missing", async () => {
    permission = "granted";
    expect(await claimSubscription(undefined)).toBe("none");
  });
});
