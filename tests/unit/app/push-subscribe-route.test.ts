// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Err = { code: string; message?: string } | null;

let claims: { sub?: string } | null = { sub: "u1" };
let rpcError: Err = null;
let deleteError: Err = null;
const rpc = vi.fn();
const from = vi.fn();
const del = vi.fn();
const eq = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null }) },
    rpc: async (fn: string, args: unknown) => {
      rpc(fn, args);
      return { data: null, error: rpcError };
    },
    from: (table: string) => {
      from(table);
      return {
        delete: () => {
          del();
          return {
            eq: async (col: string, value: unknown) => {
              eq(col, value);
              return { error: deleteError };
            },
          };
        },
      };
    },
  }),
}));

const { POST, DELETE } = await import("@/app/api/push/subscribe/route");

const URL_ = "https://questrix.app/api/push/subscribe";
const ORIGIN = "https://questrix.app";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const valid = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };
/** Built from code points, not typed: 2 and 4 UTF-8 bytes. */
const E_ACUTE = String.fromCodePoint(0xe9);
const EMOJI = String.fromCodePoint(0x1f600);

/** A valid subscription JSON of exactly `bytes` UTF-8 bytes, padded with `ch` (1 or 2 bytes). */
function sized(bytes: number, ch: string) {
  const enc = (s: string) => new TextEncoder().encode(s).byteLength;
  const room = bytes - enc(JSON.stringify({ ...valid, pad: "" }));
  const w = enc(ch);
  const pad = ch.repeat(Math.floor(room / w)) + "x".repeat(room % w);
  const body = JSON.stringify({ ...valid, pad });
  if (enc(body) !== bytes)
    throw new Error(`sized(${bytes}) built ${enc(body)}`);
  return body;
}

/**
 * A request whose user-agent is a non-ByteString. Real headers can't carry
 * one (fetch's Headers refuses it, and Node decodes header bytes as latin1),
 * so this overrides get() to pin the code-point cut on its own.
 */
function withUserAgent(r: Request, ua: string) {
  const real = r.headers;
  const headers = new Proxy(real, {
    get(target, prop) {
      if (prop === "get") {
        return (name: string) =>
          name.toLowerCase() === "user-agent" ? ua : target.get(name);
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  Object.defineProperty(r, "headers", { value: headers });
  return r;
}

function req(
  method: "POST" | "DELETE",
  body: unknown,
  headers: Record<string, string> = { origin: ORIGIN },
) {
  return new Request(URL_, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  claims = { sub: "u1" };
  rpcError = null;
  deleteError = null;
  rpc.mockReset();
  from.mockReset();
  del.mockReset();
  eq.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => errorSpy.mockRestore());

describe("POST /api/push/subscribe guard", () => {
  it("refuses a cross-origin request before touching the database", async () => {
    const res = await POST(req("POST", valid, { origin: "https://evil.com" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a request with neither Origin nor Sec-Fetch-Site", async () => {
    const res = await POST(req("POST", valid, {}));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts Sec-Fetch-Site: same-origin when Origin is missing", async () => {
    const res = await POST(
      req("POST", valid, { "sec-fetch-site": "same-origin" }),
    );
    expect(res.status).toBe(200);
  });

  it("refuses Sec-Fetch-Site: cross-site", async () => {
    const res = await POST(
      req("POST", valid, { "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 when signed out", async () => {
    claims = null;
    const res = await POST(req("POST", valid));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in first" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 401 for claims without a sub", async () => {
    claims = {};
    const res = await POST(req("POST", valid));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/push/subscribe validation", () => {
  it.each([
    ["not JSON", "{nope"],
    ["empty body", ""],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await POST(req("POST", body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for a body over 4 KB, even when it is valid JSON", async () => {
    const big = { ...valid, pad: "x".repeat(4096) };
    const res = await POST(req("POST", big));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for a Content-Length over 4096 without reading the body", async () => {
    const r = req("POST", valid, { origin: ORIGIN, "content-length": "4097" });
    expect(r.headers.get("content-length")).toBe("4097");
    const res = await POST(r);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(r.bodyUsed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared length on DELETE too, unread", async () => {
    const r = req(
      "DELETE",
      { endpoint: ENDPOINT },
      { origin: ORIGIN, "content-length": "100000" },
    );
    const res = await DELETE(r);
    expect(res.status).toBe(400);
    expect(r.bodyUsed).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("reads the body when Content-Length is exactly 4096", async () => {
    const body = sized(4096, "x");
    const res = await POST(
      req("POST", body, { origin: ORIGIN, "content-length": "4096" }),
    );
    expect(res.status).toBe(200);
  });

  it("still checks the bytes read when Content-Length understates them", async () => {
    const r = req("POST", sized(4097, "x"), {
      origin: ORIGIN,
      "content-length": "10",
    });
    const res = await POST(r);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("counts bytes, not characters: a 4096-byte multi-byte body passes", async () => {
    const body = sized(4096, E_ACUTE);
    expect(body.length).toBeLessThan(4096);
    expect(new TextEncoder().encode(body).byteLength).toBe(4096);
    const res = await POST(req("POST", body));
    expect(res.status).toBe(200);
  });

  it("counts bytes, not characters: a 4097-byte multi-byte body fails", async () => {
    const body = sized(4097, E_ACUTE);
    // Under 4096 characters: only a byte count catches it.
    expect(body.length).toBeLessThan(4096);
    expect(new TextEncoder().encode(body).byteLength).toBe(4097);
    const res = await POST(req("POST", body));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("decodes a multi-byte body as UTF-8", async () => {
    const res = await POST(req("POST", sized(2000, E_ACUTE)));
    expect(res.status).toBe(200);
  });

  it("accepts a body of exactly 4096 characters", async () => {
    const base = JSON.stringify({ ...valid, pad: "" });
    const body = JSON.stringify({
      ...valid,
      pad: "x".repeat(4096 - base.length),
    });
    expect(body.length).toBe(4096);
    const res = await POST(req("POST", body));
    expect(res.status).toBe(200);
  });

  it.each([
    ["http (not https)", "http://fcm.googleapis.com/fcm/send/x"],
    ["an unknown host", "https://evil.example/fcm/send/x"],
    ["a lookalike host", "https://fcm.googleapis.com.evil.com/x"],
    ["userinfo before the host", "https://fcm.googleapis.com@evil.com/x"],
    ["no path slash", "https://fcm.googleapis.com"],
    ["a port", "https://fcm.googleapis.com:8443/x"],
    ["a space", "https://fcm.googleapis.com/a b"],
    [
      "a non-ASCII char",
      `https://fcm.googleapis.com/${String.fromCharCode(233)}`,
    ],
    ["over 1024 chars", `https://fcm.googleapis.com/${"a".repeat(1000)}`],
    ["a bare apple domain", "https://push.apple.com/x"],
  ])("returns 400 for an endpoint with %s", async (_label, endpoint) => {
    const res = await POST(req("POST", { ...valid, endpoint }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid subscription" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QABC",
    "https://api.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ])("accepts the allowlisted endpoint %s", async (endpoint) => {
    const res = await POST(req("POST", { ...valid, endpoint }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["p256dh one short", { p256dh: "B".repeat(86), auth: AUTH }],
    ["p256dh one long", { p256dh: "B".repeat(88), auth: AUTH }],
    ["p256dh standard base64", { p256dh: "+".repeat(87), auth: AUTH }],
    ["auth one short", { p256dh: P256DH, auth: "a".repeat(21) }],
    ["auth one long", { p256dh: P256DH, auth: "a".repeat(23) }],
    ["auth single pad", { p256dh: P256DH, auth: `${"a".repeat(22)}=` }],
    ["auth standard base64", { p256dh: P256DH, auth: "/".repeat(22) }],
    ["missing auth", { p256dh: P256DH }],
    ["non-string key", { p256dh: 1, auth: AUTH }],
  ])("returns 400 for keys with %s", async (_label, keys) => {
    const res = await POST(req("POST", { endpoint: ENDPOINT, keys }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts padded key forms", async () => {
    const res = await POST(
      req("POST", {
        endpoint: ENDPOINT,
        keys: { p256dh: `${P256DH}=`, auth: `${AUTH}==` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ["null", null],
    ["an array", [valid]],
    ["missing keys", { endpoint: ENDPOINT }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await POST(req("POST", body));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/push/subscribe save", () => {
  it("saves through the RPC with the user agent", async () => {
    const res = await POST(
      req("POST", valid, { origin: ORIGIN, "user-agent": "Mozilla/5.0 test" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_push_subscription", {
      p_endpoint: ENDPOINT,
      p_p256dh: P256DH,
      p_auth: AUTH,
      p_user_agent: "Mozilla/5.0 test",
    });
  });

  it("never sends a user id: the RPC derives it from auth.uid()", async () => {
    await POST(req("POST", { ...valid, user_id: "someone-else" }));
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      "p_auth",
      "p_endpoint",
      "p_p256dh",
      "p_user_agent",
    ]);
    expect(JSON.stringify(args)).not.toContain("someone-else");
  });

  it("caps the user agent at 512 characters", async () => {
    const ua = "U".repeat(600);
    await POST(req("POST", valid, { origin: ORIGIN, "user-agent": ua }));
    const args = rpc.mock.calls[0][1] as { p_user_agent: string };
    expect(args.p_user_agent).toBe("U".repeat(512));
  });

  it("cuts the user agent at 512 code points without splitting an emoji", async () => {
    // 511 + 1 emoji = 512 code points but 513 UTF-16 units: kept whole.
    const ua = `${"U".repeat(511)}${EMOJI}${EMOJI}tail`;
    await POST(withUserAgent(req("POST", valid), ua));
    const args = rpc.mock.calls[0][1] as { p_user_agent: string };
    expect(args.p_user_agent).toBe(`${"U".repeat(511)}${EMOJI}`);
    expect(Array.from(args.p_user_agent)).toHaveLength(512);
    expect(args.p_user_agent).toHaveLength(513);
  });

  it("keeps 512 emoji whole and drops the 513th", async () => {
    const ua = EMOJI.repeat(513);
    await POST(withUserAgent(req("POST", valid), ua));
    const args = rpc.mock.calls[0][1] as { p_user_agent: string };
    expect(args.p_user_agent).toBe(EMOJI.repeat(512));
  });

  it("passes undefined for an empty user agent", async () => {
    await POST(req("POST", valid, { origin: ORIGIN, "user-agent": "" }));
    const args = rpc.mock.calls[0][1] as { p_user_agent?: string };
    expect(args.p_user_agent).toBeUndefined();
  });

  it("passes undefined when there is no user agent", async () => {
    const r = req("POST", valid);
    r.headers.delete("user-agent");
    await POST(r);
    const args = rpc.mock.calls[0][1] as { p_user_agent?: string };
    expect(args.p_user_agent).toBeUndefined();
  });

  it("returns 429 for the device cap (QX001)", async () => {
    rpcError = { code: "QX001", message: "too many" };
    const res = await POST(req("POST", valid));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Too many devices have notifications on",
    });
  });

  it("returns a generic 500 and never logs the endpoint or keys", async () => {
    rpcError = { code: "23514", message: `bad ${ENDPOINT}` };
    const res = await POST(req("POST", valid));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Couldn't save" });
    expect(JSON.stringify(body)).not.toContain("fcm");
    expect(errorSpy).toHaveBeenCalledOnce();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("23514");
    expect(logged).not.toContain(ENDPOINT);
    expect(logged).not.toContain("fcm.googleapis");
    expect(logged).not.toContain(P256DH);
    expect(logged).not.toContain(AUTH);
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("refuses a cross-origin request", async () => {
    const res = await DELETE(
      req("DELETE", { endpoint: ENDPOINT }, { origin: "https://evil.com" }),
    );
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    claims = null;
    const res = await DELETE(req("DELETE", { endpoint: ENDPOINT }));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 400 for bad JSON and oversized bodies", async () => {
    expect((await DELETE(req("DELETE", "{"))).status).toBe(400);
    expect(
      (
        await DELETE(
          req("DELETE", { endpoint: ENDPOINT, pad: "x".repeat(5000) }),
        )
      ).status,
    ).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-allowlisted endpoint", async () => {
    const res = await DELETE(
      req("DELETE", { endpoint: "https://evil.example/x" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid subscription" });
    expect(from).not.toHaveBeenCalled();
  });

  it("deletes by endpoint only (RLS scopes it to the owner)", async () => {
    const res = await DELETE(req("DELETE", { endpoint: ENDPOINT }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(from).toHaveBeenCalledExactlyOnceWith("push_subscriptions");
    expect(del).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenCalledExactlyOnceWith("endpoint", ENDPOINT);
  });

  it("returns a generic 500 and never logs the endpoint", async () => {
    deleteError = { code: "42501", message: `denied ${ENDPOINT}` };
    const res = await DELETE(req("DELETE", { endpoint: ENDPOINT }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't remove" });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("42501");
    expect(logged).not.toContain(ENDPOINT);
  });
});
