// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * public/sw.js fetch handling (DECISIONS H11): Today's last copy for
 * offline viewing, cache-first hashed assets, nothing else cached.
 */
const SRC = readFileSync(
  fileURLToPath(new URL("../../../public/sw.js", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://questrix.app";

/** An in-memory Cache Storage keyed by cache name, then by URL path. */
function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) =>
    typeof r === "string" ? r : new URL(r.url).pathname;
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      match: async (r: Request | string) => m.get(key(r))?.clone(),
      put: async (r: Request | string, res: Response) => {
        m.set(key(r), res);
      },
      delete: async (r: Request | string) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((k) => new Request(ORIGIN + k)),
      addAll: async () => undefined,
    };
  };
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (r: Request | string, opts?: { cacheName?: string }) => {
      const names = opts?.cacheName ? [opts.cacheName] : [...store.keys()];
      for (const n of names) {
        const hit = store.get(n)?.get(key(r));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  return { caches, store };
}

function load(fetchImpl: (r: Request) => Promise<Response>) {
  const handlers = new Map<string, (e: unknown) => void>();
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification: vi.fn() },
    clients: { matchAll: vi.fn(), openWindow: vi.fn(), claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (t: string, fn: (e: unknown) => void) =>
      handlers.set(t, fn),
  };
  const { caches, store } = fakeCaches();
  const fetch = vi.fn(fetchImpl);
  new Function("self", "caches", "fetch", SRC)(self, caches, fetch);
  return { handlers, caches, store, fetch };
}

/** Dispatch a fetch event; resolves to what respondWith got, or null. */
async function request(
  h: Map<string, (e: unknown) => void>,
  path: string,
  init: { mode?: string; method?: string } = {},
): Promise<Response | null> {
  let responded: Promise<Response> | null = null;
  h.get("fetch")!({
    request: {
      url: ORIGIN + path,
      method: init.method ?? "GET",
      mode: init.mode ?? "navigate",
    },
    respondWith: (p: Promise<Response>) => {
      responded = p;
    },
  });
  return responded ? await responded : null;
}

type FakeRes = {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  text: () => Promise<string>;
  clone: () => FakeRes;
};

/** A minimal response: real Responses have a read-only `type`. */
function page(body: string, extra: Partial<FakeRes> = {}): Response {
  const make = (): FakeRes => ({
    ok: true,
    status: 200,
    type: "basic",
    redirected: false,
    text: async () => body,
    clone: make,
    ...extra,
  });
  return make() as unknown as Response;
}

describe("service worker offline Today", () => {
  it("keeps the last online Today and serves it when offline", async () => {
    let online = true;
    const sw = load(async () => {
      if (!online) throw new TypeError("offline");
      return page("today v1");
    });
    expect(await (await request(sw.handlers, "/today"))!.text()).toBe(
      "today v1",
    );
    online = false;
    expect(await (await request(sw.handlers, "/today"))!.text()).toBe(
      "today v1",
    );
  });

  it("drops the copy when Today redirects (signed out)", async () => {
    let mode: "ok" | "redirect" | "offline" = "ok";
    const sw = load(async () => {
      if (mode === "offline") throw new TypeError("offline");
      return mode === "ok"
        ? page("today")
        : page("login", { redirected: true });
    });
    await request(sw.handlers, "/today");
    mode = "redirect";
    await request(sw.handlers, "/today");
    mode = "offline";
    // No copy left: the offline page (not precached in the fake) or an error.
    const res = await request(sw.handlers, "/today");
    expect(res!.type).toBe("error");
  });

  it("never caches other pages", async () => {
    let online = true;
    const sw = load(async () => {
      if (!online) throw new TypeError("offline");
      return page("shop");
    });
    await request(sw.handlers, "/shop");
    expect(sw.store.get("questrix-pages")?.has("/shop") ?? false).toBe(false);
    online = false;
    expect((await request(sw.handlers, "/shop"))!.type).toBe("error");
  });

  it("serves hashed static assets cache-first", async () => {
    const sw = load(async () => page("css"));
    await request(sw.handlers, "/_next/static/chunks/a.css", {
      mode: "no-cors",
    });
    await request(sw.handlers, "/_next/static/chunks/a.css", {
      mode: "no-cors",
    });
    expect(sw.fetch).toHaveBeenCalledOnce();
  });

  it("leaves API calls and POSTs to the network", async () => {
    const sw = load(async () => page("x"));
    expect(
      await request(sw.handlers, "/api/push/subscribe", { mode: "cors" }),
    ).toBeNull();
    expect(await request(sw.handlers, "/today", { method: "POST" })).toBeNull();
  });
});
