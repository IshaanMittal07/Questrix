import { describe, expect, it } from "vitest";

import { todaySchema } from "@/lib/today/types";

const day = (completedAt: string, until: string) => ({
  local_date: "2026-11-18",
  local_hour: 9,
  timezone: "UTC",
  username: "ada",
  display_name: null,
  points_balance: 0,
  lifetime_points: 0,
  level: 1,
  current_streak: 0,
  longest_streak: 0,
  streak_freezes: 0,
  freezes_needed: 0,
  counted_today: false,
  relived: false,
  scheduled_count: 1,
  completed_count: 1,
  at_risk: false,
  undo_window_minutes: 15,
  habits: [
    {
      id: "h1",
      title: "Read",
      category: "mind",
      icon: null,
      color: null,
      difficulty: "easy",
      target: 1,
      done: 1,
      habit_streak: 1,
      completions: [
        {
          id: "c1",
          occurrence: 1,
          points_awarded: 10,
          completed_at: completedAt,
          undoable_until: until,
        },
      ],
    },
  ],
});

describe("todaySchema timestamps", () => {
  it("accepts Postgres's microseconds and +00:00 offset, and Date.parse reads them", () => {
    const until = "2026-11-18T12:15:00.123456+00:00";
    const parsed = todaySchema.parse(
      day("2026-11-18T12:00:00.123456+00:00", until),
    );
    const c = parsed.habits[0].completions[0];
    expect(Date.parse(c.undoable_until)).toBe(
      Date.parse("2026-11-18T12:15:00.123Z"),
    );
  });

  it("requires a boolean relived flag (#81), so a stale server fails closed", () => {
    const ok = day("2026-11-18T12:00:00+00:00", "2026-11-18T12:15:00+00:00");
    expect(todaySchema.parse({ ...ok, relived: true }).relived).toBe(true);
    const missing: Record<string, unknown> = { ...ok };
    delete missing.relived;
    expect(todaySchema.safeParse(missing).success).toBe(false);
    expect(todaySchema.safeParse({ ...ok, relived: "true" }).success).toBe(
      false,
    );
  });

  it("rejects a timestamp Date.parse might not read", () => {
    expect(
      todaySchema.safeParse(day("2026-11-18 12:00:00+00", "tomorrow")).success,
    ).toBe(false);
  });
});
