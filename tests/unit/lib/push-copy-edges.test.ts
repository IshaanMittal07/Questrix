import { describe, expect, it } from "vitest";
import {
  reminderMessage,
  streakSaverMessage,
  type ReminderRow,
} from "@/lib/push/copy";

const CATEGORIES = [
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
] as const;
const RANDOMS = [0, 0.49, 0.5, 0.999999, 1, -0.5, 2];

const row = (over: Partial<ReminderRow> = {}): ReminderRow => ({
  habit_id: "22222222-2222-2222-2222-222222222222",
  title: "Stretch",
  icon: null,
  category: "other",
  points: 15,
  streak: 0,
  ...over,
});

describe("reminderMessage for every category", () => {
  for (const category of CATEGORIES) {
    for (const icon of [null, "🧘"]) {
      it(`${category}, icon ${icon ? "present" : "null"}`, () => {
        const bodies = new Set<string>();
        for (const r of RANDOMS) {
          const m = reminderMessage(row({ category, icon }), () => r);
          expect(Object.keys(m).sort()).toEqual([
            "body",
            "tag",
            "title",
            "url",
          ]);
          expect(m.title).toBe(icon ? `${icon} Stretch` : "Stretch");
          expect(m.body).toContain("Stretch");
          expect(m.body).not.toContain("undefined");
          expect(m.body).not.toMatch(/×|\bx\d|\d+x\b/);
          expect(m.body).not.toMatch(/streak/i);
          expect(m.url).toBe(
            "/today?habit=22222222-2222-2222-2222-222222222222",
          );
          expect(m.tag).toBe("habit-22222222-2222-2222-2222-222222222222");
          bodies.add(m.body);
        }
        // Both lines are reachable.
        expect(bodies.size).toBe(2);
      });
    }
  }

  it("only ever shows the server's points, never a computed amount", () => {
    for (const category of CATEGORIES) {
      for (const r of [0, 0.99]) {
        const body = reminderMessage(
          row({ category, points: 37 }),
          () => r,
        ).body;
        for (const n of body.match(/\d+/g) ?? []) expect(n).toBe("37");
      }
    }
  });

  it("treats an empty icon string as no icon", () => {
    expect(reminderMessage(row({ icon: "" }), () => 0).title).toBe("Stretch");
  });

  it("url-encodes the habit id so it can't escape the query", () => {
    const m = reminderMessage(row({ habit_id: "a&b=c#d" }), () => 0);
    expect(m.url).toBe("/today?habit=a%26b%3Dc%23d");
    expect(m.url.startsWith("/today")).toBe(true);
  });

  it("names a streak of exactly 2 and not 1", () => {
    expect(reminderMessage(row({ streak: 2 }), () => 0).body).toMatch(
      /Keep the 2-day streak alive/,
    );
    expect(reminderMessage(row({ streak: 1 }), () => 0).body).not.toMatch(
      /streak/,
    );
    expect(reminderMessage(row({ streak: -3 }), () => 0).body).not.toMatch(
      /streak/,
    );
  });
});

describe("streakSaverMessage", () => {
  it("is well-formed for every line, including out-of-range randoms", () => {
    const bodies = new Set<string>();
    for (const r of RANDOMS) {
      const m = streakSaverMessage(3, () => r);
      expect(m).toMatchObject({
        title: "Streak at risk",
        url: "/today",
        tag: "streak-saver",
      });
      expect(m.body).toMatch(/\b3\b/);
      expect(m.body).not.toMatch(/×|\bx\d/);
      bodies.add(m.body);
    }
    expect(bodies.size).toBe(3);
  });

  it("round-trips through JSON as the payload sw.js parses", () => {
    const m = streakSaverMessage(10, () => 0.4);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
