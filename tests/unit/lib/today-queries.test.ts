// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { data?: unknown; error?: unknown };
const calls: string[] = [];
let result: Result = {};
let userId: string | null = "u1";

const client = {
  auth: {
    getClaims: async () => ({
      data: userId ? { claims: { sub: userId } } : null,
    }),
  },
  rpc: (fn: string) => {
    calls.push(fn);
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
    });
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { getToday, loadToday } = await import("@/lib/today/queries");
type Client = Parameters<typeof loadToday>[0];

const completion = {
  id: "c1",
  occurrence: 1,
  points_awarded: 10,
  completed_at: "2026-11-18T09:00:00Z",
  undoable_until: "2026-11-18T09:05:00Z",
};

const today = {
  local_date: "2026-11-18",
  local_hour: 9,
  timezone: "Asia/Kolkata",
  username: "ada",
  display_name: "Ada",
  points_balance: 10,
  lifetime_points: 10,
  level: 1,
  current_streak: 1,
  longest_streak: 4,
  streak_freezes: 1,
  freezes_needed: 0,
  counted_today: true,
  relived: false,
  scheduled_count: 1,
  completed_count: 1,
  at_risk: false,
  undo_window_minutes: 5,
  habits: [
    {
      id: "h1",
      title: "Read",
      category: "learning",
      icon: null,
      color: null,
      difficulty: "medium",
      target: 1,
      done: 1,
      joined_late: false,
      habit_streak: 1,
      completions: [completion],
    },
  ],
};

beforeEach(() => {
  calls.length = 0;
  result = {};
  userId = "u1";
});

describe("loadToday", () => {
  it("parses get_today", async () => {
    result = { data: today };
    expect(await loadToday(client as unknown as Client)).toEqual({
      ok: true,
      today,
    });
    expect(calls).toEqual(["get_today"]);
  });

  it.each([
    ["28000", "signed_out"],
    ["QX107", "not_onboarded"],
    ["P0001", "failed"],
    [undefined, "failed"],
  ])("maps error %s to %s", async (code, reason) => {
    result = { error: { code } };
    expect(await loadToday(client as unknown as Client)).toEqual({
      ok: false,
      reason,
    });
  });

  it.each([
    ["no data", null],
    ["a missing field", { ...today, at_risk: undefined }],
    ["a fractional count", { ...today, points_balance: 1.5 }],
    [
      "a broken completion",
      {
        ...today,
        habits: [
          { ...today.habits[0], completions: [{ ...completion, id: 1 }] },
        ],
      },
    ],
  ])("fails on %s rather than rendering bad numbers", async (_, data) => {
    result = { data };
    expect(await loadToday(client as unknown as Client)).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("getToday", () => {
  it("is signed_out without a verified user, without calling get_today", async () => {
    userId = null;
    expect(await getToday()).toEqual({ ok: false, reason: "signed_out" });
    expect(calls).toEqual([]);
  });

  it("loads for a verified user", async () => {
    result = { data: today };
    expect(await getToday()).toEqual({ ok: true, today });
  });
});
