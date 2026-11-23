import { describe, expect, it } from "vitest";
import {
  reminderMessage,
  streakSaverMessage,
  type ReminderRow,
} from "@/lib/push/copy";

const row = (over: Partial<ReminderRow> = {}): ReminderRow => ({
  habit_id: "11111111-1111-1111-1111-111111111111",
  title: "Read",
  icon: "📚",
  category: "learning",
  points: 20,
  streak: 0,
  ...over,
});

describe("reminderMessage", () => {
  it("is deterministic under a fixed random source", () => {
    expect(reminderMessage(row(), () => 0)).toEqual(
      reminderMessage(row(), () => 0),
    );
    expect(reminderMessage(row(), () => 0).body).not.toEqual(
      reminderMessage(row(), () => 0.99).body,
    );
  });

  it("deep-links to the habit and tags by habit", () => {
    const m = reminderMessage(row(), () => 0);
    expect(m.url).toBe("/today?habit=11111111-1111-1111-1111-111111111111");
    expect(m.tag).toBe("habit-11111111-1111-1111-1111-111111111111");
    expect(m.title).toBe("📚 Read");
  });

  it("uses the title alone when there's no icon", () => {
    expect(reminderMessage(row({ icon: null }), () => 0).title).toBe("Read");
  });

  it("never claims a streak of 0 or 1, and names a live one", () => {
    for (const r of [0, 0.5, 0.99]) {
      expect(reminderMessage(row({ streak: 0 }), () => r).body).not.toMatch(
        /streak/,
      );
      expect(reminderMessage(row({ streak: 1 }), () => r).body).not.toMatch(
        /streak/,
      );
    }
    expect(reminderMessage(row({ streak: 12 }), () => 0).body).toMatch(
      /12-day streak/,
    );
  });

  it("falls back to generic copy for an unknown category, and never shows a multiplier", () => {
    const m = reminderMessage(row({ category: "weird" }), () => 0);
    expect(m.body).toContain("Read");
    for (const c of [
      "health",
      "fitness",
      "mind",
      "learning",
      "career",
      "self_care",
      "nutrition",
      "finance",
      "social",
      "other",
    ]) {
      for (const r of [0, 0.99]) {
        expect(reminderMessage(row({ category: c }), () => r).body).not.toMatch(
          /×|\bx\d/,
        );
      }
    }
  });

  it("handles a random source that returns 1", () => {
    expect(() => reminderMessage(row(), () => 1)).not.toThrow();
  });
});

describe("streakSaverMessage", () => {
  it("names the streak and opens Today", () => {
    const m = streakSaverMessage(7, () => 0);
    expect(m.body).toMatch(/7-day/);
    expect(m.url).toBe("/today");
    expect(m.tag).toBe("streak-saver");
  });
});
