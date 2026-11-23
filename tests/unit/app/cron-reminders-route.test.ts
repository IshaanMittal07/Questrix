import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { sendNotification, runReminders } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  runReminders: vi.fn(),
}));
vi.mock("web-push", async (orig) => ({
  ...(await orig<typeof import("web-push")>()),
  sendNotification,
}));
vi.mock("@/lib/push/run", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/run")>()),
  runReminders,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { generateVAPIDKeys } from "web-push";
import { POST, maxDuration } from "@/app/api/cron/reminders/route";
import { RunError } from "@/lib/push/run";
import { config } from "@/proxy";

const KEYS = generateVAPIDKeys();
const ENV = {
  CRON_SECRET: "cron-secret-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
  VAPID_SUBJECT: "mailto:ops@example.com",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: KEYS.publicKey,
  VAPID_PRIVATE_KEY: KEYS.privateKey,
};
const COUNTS = { sent: 0, failed: 0, removed: 0, skipped: 0, malformed: 0 };
const AUTHED = `Bearer ${ENV.CRON_SECRET}`;
const req = (auth?: string) =>
  new Request("http://localhost:3000/api/cron/reminders", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  runReminders.mockReset();
  sendNotification.mockReset();
});

describe("POST /api/cron/reminders", () => {
  it.each([
    undefined,
    "Bearer wrong",
    "Bearer cron-secret-valu",
    "cron-secret-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
  ])("returns 401 for %s and does nothing", async (auth) => {
    const res = await POST(req(auth));
    expect(res.status).toBe(401);
    expect(runReminders).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET isn't configured, whatever is sent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer "))).status).toBe(401);
  });

  it("runs and returns the counts with the secret", async () => {
    runReminders.mockResolvedValue({
      sent: 3,
      failed: 1,
      removed: 2,
      skipped: 4,
      malformed: 5,
    });
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sent: 3,
      failed: 1,
      removed: 2,
      skipped: 4,
      malformed: 5,
    });
    expect(console.info).toHaveBeenCalledWith(
      'reminders: {"sent":3,"failed":1,"removed":2,"skipped":4,"malformed":5}',
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sends with VAPID, a 1 hour TTL and high urgency", async () => {
    runReminders.mockImplementation(async ({ send }) => {
      await send(
        {
          endpoint: "https://fcm.googleapis.com/x",
          keys: { p256dh: "p", auth: "a" },
        },
        "{}",
      );
      return { ...COUNTS, sent: 1 };
    });
    await POST(req(AUTHED));
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://fcm.googleapis.com/x",
        keys: { p256dh: "p", auth: "a" },
      },
      "{}",
      {
        vapidDetails: {
          subject: ENV.VAPID_SUBJECT,
          publicKey: ENV.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          privateKey: ENV.VAPID_PRIVATE_KEY,
        },
        TTL: 3600,
        urgency: "high",
        timeout: 10_000,
      },
    );
  });

  it("returns 500 without leaking anything when VAPID is missing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Push is not configured" });
    expect(runReminders).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      ENV.CRON_SECRET,
    );
  });

  it("returns 500 with a generic body on a run error, logging the steps and counts", async () => {
    runReminders.mockRejectedValue(
      new RunError(["due_reminders (PGRST301)", "due_streak_savers (57014)"], {
        ...COUNTS,
        sent: 2,
      }),
    );
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reminders failed" });
    expect(console.error).toHaveBeenCalledWith(
      'reminders: due_reminders (PGRST301), due_streak_savers (57014) failed {"sent":2,"failed":0,"removed":0,"skipped":0,"malformed":0}',
    );
  });

  it("logs a generic line for any other error, without its message", async () => {
    runReminders.mockRejectedValue(
      new Error("fetch failed https://x.supabase.co"),
    );
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["reminders: run failed"],
    ]);
  });

  it("flags a run where every push failed as a VAPID problem", async () => {
    runReminders.mockResolvedValue({ ...COUNTS, failed: 7 });
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...COUNTS, failed: 7 });
    expect(console.error).toHaveBeenCalledWith(
      "reminders: every push failed; check the VAPID keys",
    );
  });

  it.each([
    ["nothing was due", COUNTS],
    ["one push got through", { ...COUNTS, sent: 1, failed: 9 }],
    ["only removals", { ...COUNTS, removed: 3 }],
    ["only skips", { ...COUNTS, skipped: 3 }],
  ])("doesn't flag VAPID when %s", async (_label, counts) => {
    runReminders.mockResolvedValue(counts);
    await POST(req(AUTHED));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("refuses a too-short CRON_SECRET even when the caller sends it exactly", async () => {
    vi.stubEnv("CRON_SECRET", "short-secret");
    expect((await POST(req("Bearer short-secret"))).status).toBe(401);
    expect(runReminders).not.toHaveBeenCalled();
  });

  it("returns 500 for a padded VAPID key, before running", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", `${KEYS.privateKey}=`);
    const res = await POST(req(AUTHED));
    expect(res.status).toBe(500);
    expect(runReminders).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      KEYS.privateKey,
    );
  });

  it("has a bounded duration", () => {
    expect(maxDuration).toBe(60);
  });
});

describe("proxy matcher", () => {
  const matches = (path: string) =>
    config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("skips the cron (pg_net has no session) but still covers other routes", () => {
    expect(matches("/api/cron/reminders")).toBe(false);
    expect(matches("/today")).toBe(true);
    expect(matches("/api/push/subscribe")).toBe(true);
  });
});
