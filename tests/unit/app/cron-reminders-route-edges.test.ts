import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { sendNotification, createAdminClient } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("web-push", () => ({ sendNotification }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import * as route from "@/app/api/cron/reminders/route";
import { POST } from "@/app/api/cron/reminders/route";
import { hasBearer } from "@/lib/http/bearer";

const ENV = {
  CRON_SECRET: "cron-secret-value-0123456789",
  VAPID_SUBJECT: "mailto:ops@example.com",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "B" + "q".repeat(86),
  VAPID_PRIVATE_KEY: "Z".repeat(43),
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-should-never-leak",
};
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-token-xyz";
const P256DH = "BPubKeyOfTheDevice_p256dh_value";
const AUTH = "deviceAuthSecret";
const SECRETS = [
  ENV.CRON_SECRET,
  ENV.VAPID_PRIVATE_KEY,
  ENV.SUPABASE_SERVICE_ROLE_KEY,
  ENDPOINT,
  "device-token-xyz",
  P256DH,
  AUTH,
];

const req = (auth?: string, method = "POST") =>
  new Request("http://localhost:3000/api/cron/reminders", {
    method,
    headers: auth ? { authorization: auth } : {},
  });
const AUTHED = `Bearer ${ENV.CRON_SECRET}`;

type Rpc = { data?: unknown; error?: { code: string; message?: string } };
function fakeAdmin(rpc: Record<string, Rpc>, writeError?: unknown) {
  return {
    rpc: vi.fn(async (name: string) => {
      const r = rpc[name] ?? { data: [] };
      return { data: r.data ?? null, error: r.error ?? null };
    }),
    from: vi.fn(() => ({
      update: () => ({ in: async () => ({ error: writeError ?? null }) }),
      delete: () => ({ in: async () => ({ error: writeError ?? null }) }),
    })),
  };
}
const dueRow = {
  user_id: "u1",
  habit_id: "h1",
  local_date: "2026-12-01",
  reminder_time: "08:00:00",
  title: "Read",
  icon: null,
  category: "learning",
  points: 20,
  streak: 3,
  subscriptions: [{ id: "s1", endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH }],
};

/** Everything written to the console in this test, as one string. */
const logged = () =>
  JSON.stringify(
    (["log", "info", "warn", "error", "debug", "trace"] as const).flatMap(
      (m) => vi.mocked(console[m]).mock.calls,
    ),
  );

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  for (const m of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  // The secret-free log check runs for every test in this file.
  const out = logged();
  for (const s of SECRETS) expect(out).not.toContain(s);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sendNotification.mockReset();
  createAdminClient.mockReset();
});

describe("route exports", () => {
  it("exports POST only, and no dynamic/runtime config", () => {
    const methods = ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];
    for (const m of methods) expect(route).not.toHaveProperty(m);
    expect(typeof route.POST).toBe("function");
    expect(route).not.toHaveProperty("dynamic");
    expect(route).not.toHaveProperty("runtime");
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
  });
});

describe("POST /api/cron/reminders, end to end through run and send", () => {
  it("sends the sw.js payload with VAPID and returns the counts", async () => {
    createAdminClient.mockReturnValue(
      fakeAdmin({ due_reminders: { data: [dueRow] } }),
    );
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 0, removed: 0 });
    const [subscription, payload, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
    });
    const p = JSON.parse(payload as string);
    expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url"]);
    expect(p.url).toBe("/today?habit=h1");
    expect(p.tag).toBe("habit-h1");
    expect(options).toMatchObject({ TTL: 3600, urgency: "high" });
    expect(console.info).toHaveBeenCalledWith(
      'reminders: {"sent":1,"failed":0,"removed":0}',
    );
  });

  it("never logs a web-push error, which carries the endpoint and body", async () => {
    createAdminClient.mockReturnValue(
      fakeAdmin({ due_reminders: { data: [dueRow] } }),
    );
    sendNotification.mockRejectedValue(
      Object.assign(
        new Error(`Received unexpected response code ${ENDPOINT}`),
        {
          statusCode: 500,
          endpoint: ENDPOINT,
          body: `bad push for ${P256DH}`,
        },
      ),
    );
    const res = await POST(req(AUTHED));
    expect(await res.json()).toEqual({ sent: 0, failed: 1, removed: 0 });
  });

  it("logs a write failure by step and code, with the partial counts", async () => {
    createAdminClient.mockReturnValue(
      fakeAdmin(
        {
          due_reminders: { data: [dueRow] },
          due_streak_savers: {
            error: { code: "57014", message: `timeout near ${ENDPOINT}` },
          },
        },
        { code: "42501", message: `denied ${ENDPOINT}` },
      ),
    );
    sendNotification.mockResolvedValue({});
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reminders failed" });
    expect(console.error).toHaveBeenCalledWith(
      "reminders: record successes failed (42501)",
    );
  });

  it("logs the saver failure with what was sent before it", async () => {
    createAdminClient.mockReturnValue(
      fakeAdmin({
        due_reminders: { data: [dueRow] },
        due_streak_savers: {
          error: { code: "57014", message: `timeout near ${ENDPOINT}` },
        },
      }),
    );
    sendNotification.mockResolvedValue({});
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      'reminders: due_streak_savers failed (57014) {"sent":1,"failed":0,"removed":0}',
    );
  });

  it("returns a generic 500 when the admin client can't be built, without its message", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error(`bad key ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    });
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reminders failed" });
    expect(console.error).toHaveBeenCalledWith("reminders: run failed");
  });

  it("returns a generic 500 when the rpc itself throws (network), without its message", async () => {
    createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => {
        throw new Error(`fetch failed ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      }),
    });
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith("reminders: run failed");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("doesn't build the admin client or send on a bad secret", async () => {
    const res = await POST(req(`Bearer ${ENV.CRON_SECRET} `.slice(0, -2)));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("checks the secret before VAPID, so an unauthenticated caller learns nothing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const res = await POST(req("Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("reads VAPID per request, so a rotated key is used without a restart", async () => {
    createAdminClient.mockReturnValue(
      fakeAdmin({ due_reminders: { data: [dueRow] } }),
    );
    sendNotification.mockResolvedValue({});
    await POST(req(AUTHED));
    const rotated = "Y".repeat(43);
    vi.stubEnv("VAPID_PRIVATE_KEY", rotated);
    await POST(req(AUTHED));
    expect(
      sendNotification.mock.calls.map(
        (c) =>
          (c[2] as { vapidDetails: { privateKey: string } }).vapidDetails
            .privateKey,
      ),
    ).toEqual([ENV.VAPID_PRIVATE_KEY, rotated]);
  });
});

describe("hasBearer edge headers", () => {
  const h = (v: string) => new Headers({ authorization: v });

  it("compares Latin-1 header values exactly", () => {
    const e = String.fromCharCode(0xe9);
    expect(hasBearer(h(`Bearer caf${e}`), `caf${e}`)).toBe(true);
    expect(hasBearer(h("Bearer cafe"), `caf${e}`)).toBe(false);
    expect(hasBearer(h(`Bearer caf${e}`), "cafe")).toBe(false);
  });

  it("refuses a secret with extra inner whitespace or a different scheme case", () => {
    for (const v of ["Bearer  s3cret", "Bearer\ts3cret", "BEARER s3cret"]) {
      expect(hasBearer(h(v), "s3cret")).toBe(false);
    }
  });

  it("accepts surrounding whitespace, which HTTP strips from header values", () => {
    expect(hasBearer(h("  Bearer s3cret  "), "s3cret")).toBe(true);
  });

  it("refuses a very long header without throwing", () => {
    expect(hasBearer(h(`Bearer ${"s".repeat(100_000)}`), "s3cret")).toBe(false);
  });

  it("refuses a header carrying the secret twice", () => {
    const headers = new Headers();
    headers.append("authorization", "Bearer s3cret");
    headers.append("authorization", "Bearer s3cret");
    expect(hasBearer(headers, "s3cret")).toBe(false);
  });
});
