// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** A fake supabase-js client: rpc calls are recorded and resolve in order. */
type Result = { data?: unknown; error?: unknown };
const calls: Array<[string, unknown]> = [];
let results: Result[] = [];
let userId: string | null = "u1";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : null,
      }),
    },
    rpc: (fn: string, args?: unknown) => {
      calls.push([fn, args]);
      const r = results.shift() ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  }),
}));

const actions = await import("@/lib/today/actions");
const { RETRY_MESSAGE } = await import("@/lib/supabase/errors");

beforeEach(() => {
  calls.length = 0;
  results = [];
  userId = "u1";
});

const ID = "3F1C2A4E-8B7D-4C6E-9A1F-2B3C4D5E6F70";
const id = ID.toLowerCase();

const completeEvent = {
  completion_id: "c1",
  occurrence: 1,
  target: 1,
  points_awarded: 12,
  multiplier: 1.2,
  current_streak: 3,
  habit_streak: 3,
  milestone: null,
  milestone_points: null,
};

const undoEvent = {
  undone_id: "c1",
  habit_id: "h1",
  points_removed: 12,
  milestones_revoked: null,
  milestone_points_removed: 0,
};

const today = {
  local_date: "2026-11-18",
  local_hour: 9,
  timezone: "UTC",
  username: "ada",
  display_name: null,
  points_balance: 12,
  lifetime_points: 12,
  level: 1,
  current_streak: 3,
  longest_streak: 3,
  streak_freezes: 0,
  freezes_needed: 0,
  counted_today: true,
  scheduled_count: 1,
  completed_count: 1,
  at_risk: false,
  undo_window_minutes: 5,
  habits: [],
};

describe("completeHabit", () => {
  it("refuses an invalid id as not_found without calling the database", async () => {
    for (const bad of ["nope", 42, null, undefined, { id: ID }, ""]) {
      const res = await actions.completeHabit(bad);
      expect(res).toMatchObject({ ok: false, code: "not_found" });
    }
    expect(calls).toEqual([]);
  });

  it("is signed_out without a verified user", async () => {
    userId = null;
    const res = await actions.completeHabit(ID);
    expect(res).toEqual({
      ok: false,
      code: "signed_out",
      error: "You're signed out.",
    });
    expect(calls).toEqual([]);
  });

  it("calls complete_habit with the lower-cased id, then get_today", async () => {
    results = [{ data: completeEvent }, { data: today }];
    const res = await actions.completeHabit(ID);
    expect(calls).toEqual([
      ["complete_habit", { p_habit_id: id }],
      ["get_today", undefined],
    ]);
    expect(res).toEqual({ ok: true, event: completeEvent, today });
  });

  it("still succeeds with today: null when get_today fails", async () => {
    results = [{ data: completeEvent }, { error: { code: "XX000" } }];
    const res = await actions.completeHabit(ID);
    expect(res).toEqual({ ok: true, event: completeEvent, today: null });
  });

  it("returns today: null when get_today's shape is unreadable", async () => {
    results = [{ data: completeEvent }, { data: { ...today, level: "1" } }];
    const res = await actions.completeHabit(ID);
    expect(res).toEqual({ ok: true, event: completeEvent, today: null });
  });

  it("reports success with the fresh snapshot when the event is unreadable", async () => {
    // The write committed; failing here would invite a second completion.
    results = [
      { data: { ...completeEvent, points_awarded: "12" } },
      { data: today },
    ];
    const res = await actions.completeHabit(ID);
    expect(res).toMatchObject({ ok: true, event: null });
    expect(res.ok && res.today).not.toBeNull();
    expect(calls.map((c) => c[0])).toEqual(["complete_habit", "get_today"]);
  });

  it.each([
    ["QX101", "not_today", "That habit isn't scheduled today."],
    ["QX102", "not_found", "That habit is archived."],
    ["QX103", "done", "Already done for today."],
    ["QX107", "not_onboarded", "Finish setting up your account first."],
    ["P0002", "not_found", "That habit doesn't exist."],
    ["28000", "signed_out", "You're signed out."],
    ["40P01", "failed", RETRY_MESSAGE],
    ["XX000", "failed", "Couldn't save. Try again."],
    [undefined, "failed", "Couldn't save. Try again."],
    // Undo codes mean nothing here.
    ["QX104", "failed", "Couldn't save. Try again."],
  ])("maps %s to %s", async (code, expected, message) => {
    results = [{ error: { code, message: "raw db text" } }];
    const res = await actions.completeHabit(ID);
    expect(res).toEqual({ ok: false, code: expected, error: message });
    // Never the raw database message.
    expect(JSON.stringify(res)).not.toContain("raw db text");
    // No refresh after a refusal.
    expect(calls).toHaveLength(1);
  });
});

describe("undoCompletion", () => {
  it("refuses an invalid id as not_found without calling the database", async () => {
    const res = await actions.undoCompletion("pending:1");
    expect(res).toEqual({
      ok: false,
      code: "not_found",
      error: "That completion doesn't exist.",
    });
    expect(calls).toEqual([]);
  });

  it("is signed_out without a verified user", async () => {
    userId = null;
    const res = await actions.undoCompletion(ID);
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(calls).toEqual([]);
  });

  it("calls undo_completion with the lower-cased id, then get_today", async () => {
    results = [{ data: undoEvent }, { data: today }];
    const res = await actions.undoCompletion(ID);
    expect(calls).toEqual([
      ["undo_completion", { p_completion_id: id }],
      ["get_today", undefined],
    ]);
    expect(res).toEqual({ ok: true, event: undoEvent, today });
  });

  it("accepts revoked milestones", async () => {
    const event = {
      ...undoEvent,
      milestones_revoked: [7],
      milestone_points_removed: 50,
    };
    results = [{ data: event }, { data: today }];
    expect(await actions.undoCompletion(ID)).toEqual({
      ok: true,
      event,
      today,
    });
  });

  it("reports success with the fresh snapshot when the event is unreadable", async () => {
    results = [{ data: { undone_id: "c1" } }, { data: today }];
    const res = await actions.undoCompletion(ID);
    expect(res).toMatchObject({ ok: true, event: null });
    expect(res.ok && res.today).not.toBeNull();
  });

  it.each([
    ["QX104", "too_late", "The undo window has passed."],
    ["QX105", "too_late", "Only today's completions can be undone."],
    [
      "QX106",
      "no_balance",
      "You've already spent those points, so this can't be undone.",
    ],
    ["QX108", "too_late", "A later day already counts on this one."],
    ["P0002", "not_found", "That completion doesn't exist."],
    ["28000", "signed_out", "You're signed out."],
    ["XX000", "failed", "Couldn't save. Try again."],
    // Complete codes mean nothing here.
    ["QX103", "failed", "Couldn't save. Try again."],
  ])("maps %s to %s", async (code, expected, message) => {
    results = [{ error: { code, message: "raw db text" } }];
    const res = await actions.undoCompletion(ID);
    expect(res).toEqual({ ok: false, code: expected, error: message });
    expect(calls).toHaveLength(1);
  });

  it("asks for a retry on a deadlock", async () => {
    results = [{ error: { code: "40P01" } }];
    expect(await actions.undoCompletion(ID)).toEqual({
      ok: false,
      code: "failed",
      error: RETRY_MESSAGE,
    });
  });
});
