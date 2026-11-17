import { describe, expect, it } from "vitest";

import {
  COACHING,
  COMPLEMENTARY_PAIRS,
  coachingHints,
  type CoachingContext,
  type ExistingHabit,
  type HabitDraft,
  isDuplicateTitle,
  isVagueTitle,
  levenshtein,
  SCORES,
  slotOf,
  stackingCopy,
  suggestHabits,
  titleSimilarity,
} from "@/lib/habits/suggestions";
import {
  getTemplate,
  HABIT_TEMPLATES,
  type HabitTemplate,
  templateToHabit,
} from "@/lib/habits/templates";
import { cleanHabitText, habitCreateSchema } from "@/lib/validation/habit";

const habit = (over: Partial<ExistingHabit> = {}): ExistingHabit => ({
  title: "Something unrelated",
  category: "other",
  template_key: null,
  reminder_times: [],
  archived_at: null,
  ...over,
});

const fromTemplate = (key: string, over: Partial<ExistingHabit> = {}) => {
  const t = getTemplate(key)!;
  return habit({
    title: t.title,
    category: t.category,
    template_key: t.key,
    reminder_times: [...t.defaultTimes],
    ...over,
  });
};

const tpl = (over: Partial<HabitTemplate>): HabitTemplate => ({
  key: "t",
  title: "Template",
  category: "other",
  difficulty: "easy",
  icon: "x",
  defaultDays: [0, 1, 2, 3, 4, 5, 6],
  targetPerDay: 1,
  defaultTimes: [],
  tip: "",
  ...over,
});

const keys = (s: { template: HabitTemplate }[]) => s.map((x) => x.template.key);
const find = (s: ReturnType<typeof suggestHabits>, key: string) =>
  s.find((x) => x.template.key === key);

describe("template library", () => {
  it("ships the 30 templates from plan §8.1 with unique keys", () => {
    expect(HABIT_TEMPLATES).toHaveLength(30);
    expect(new Set(HABIT_TEMPLATES.map((t) => t.key)).size).toBe(30);
  });

  it("has the plan's count per category", () => {
    const counts: Record<string, number> = {};
    for (const t of HABIT_TEMPLATES)
      counts[t.category] = (counts[t.category] ?? 0) + 1;
    expect(counts).toEqual({
      self_care: 4,
      nutrition: 5,
      learning: 4,
      career: 4,
      fitness: 4,
      mind: 3,
      health: 3,
      finance: 2,
      social: 1,
    });
  });

  it.each(HABIT_TEMPLATES.map((t) => [t.key, t] as const))(
    "%s is a valid habit as is",
    (_, t) => {
      const parsed = habitCreateSchema.parse(templateToHabit(t));
      expect(parsed.title).toBe(t.title);
      expect(parsed.template_key).toBe(t.key);
      // Already normalised: the DB trigger won't change what was shown.
      expect(cleanHabitText(t.icon)).toBe(t.icon);
      expect([...t.icon]).toHaveLength(1);
      expect(parsed.reminder_times).toEqual(t.defaultTimes);
      expect(parsed.days_of_week).toEqual(t.defaultDays);
      expect(t.tip.length).toBeGreaterThan(0);
    },
  );

  it("encodes the plan's multi-time templates", () => {
    expect(getTemplate("take_supplements")).toMatchObject({
      targetPerDay: 2,
      defaultTimes: ["08:00", "20:00"],
    });
    expect(getTemplate("drink_water")).toMatchObject({
      targetPerDay: 4,
      defaultTimes: ["09:00", "12:00", "15:00", "18:00"],
    });
  });

  it("leaves medication's time to the user, with reminders off", () => {
    const h = templateToHabit(getTemplate("take_medication")!);
    expect(h.reminder_times).toEqual([]);
    expect(h.reminders_enabled).toBe(false);
  });

  it("every complementary pair names real templates", () => {
    for (const [a, b] of COMPLEMENTARY_PAIRS) {
      expect(getTemplate(a)).toBeDefined();
      expect(getTemplate(b)).toBeDefined();
    }
  });

  it("returns undefined for an unknown key", () => {
    expect(getTemplate("nope")).toBeUndefined();
  });
});

describe("title similarity (rule 4)", () => {
  it("computes Levenshtein over code points", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("😴a", "😴b")).toBe(1);
  });

  it("normalises case, NFKC and whitespace", () => {
    expect(titleSimilarity("  READ   20 pages ", "read 20 pages")).toBe(1);
    // Fullwidth "Ａ" is NFKC-equal to "A".
    expect(titleSimilarity("Ａbc", "abc")).toBe(1);
    expect(titleSimilarity("", "")).toBe(1);
  });

  it("is a duplicate only strictly above 0.8", () => {
    // Length 10: distance 2 → exactly 0.8, distance 1 → 0.9.
    expect(titleSimilarity("abcdefghij", "abcdefghXY")).toBeCloseTo(0.8);
    expect(isDuplicateTitle("abcdefghij", "abcdefghXY")).toBe(false);
    expect(isDuplicateTitle("abcdefghij", "abcdefghiX")).toBe(true);
  });
});

describe("time slots (rule 3)", () => {
  it.each([
    ["04:59", null],
    ["05:00", "morning"],
    ["10:59", "morning"],
    ["11:00", "midday"],
    ["16:59", "midday"],
    ["17:00", "evening"],
    ["22:59", "evening"],
    ["23:00", null],
    ["00:00", null],
    ["07:30:00", "morning"],
    ["24:00", null],
    ["garbage", null],
  ])("%s → %s", (time, slot) => {
    expect(slotOf(time)).toBe(slot);
  });
});

describe("suggestHabits", () => {
  it("rule 1: a paired habit gets +40 and names its trigger", () => {
    const only = [tpl({ key: "stretch", category: "fitness" })];
    const s = suggestHabits([fromTemplate("workout", { reminder_times: [] })], {
      templates: only,
    });
    expect(s).toEqual([
      {
        template: only[0],
        score: SCORES.pair,
        reasons: ["pair"],
        pairedWith: "Workout",
      },
    ]);
  });

  it.each(COMPLEMENTARY_PAIRS)("rule 1: %s → %s", (from, to) => {
    const s = suggestHabits([fromTemplate(from)]);
    expect(find(s, to)?.reasons).toContain("pair");
  });

  it("rule 1 is one-directional and ignores archived habits", () => {
    expect(
      find(suggestHabits([fromTemplate("stretch")]), "workout")?.reasons,
    ).not.toContain("pair");
    const archived = fromTemplate("workout", { archived_at: "2026-11-01" });
    expect(find(suggestHabits([archived]), "stretch")?.reasons).not.toContain(
      "pair",
    );
  });

  it("rule 1 counts once even if two habits trigger it", () => {
    const s = suggestHabits(
      [
        fromTemplate("workout"),
        fromTemplate("workout", { title: "Gym", archived_at: null }),
      ],
      { templates: [tpl({ key: "stretch", category: "fitness" })] },
    );
    expect(s[0].score).toBe(SCORES.pair);
  });

  it("rule 2: +25 only when the category has no active habit", () => {
    const t = [tpl({ key: "a", category: "mind" })];
    expect(suggestHabits([], { templates: t })[0].score).toBe(
      SCORES.categoryGap,
    );
    expect(
      suggestHabits([habit({ category: "mind" })], { templates: t }),
    ).toEqual([]);
    // An archived habit leaves the category empty.
    expect(
      suggestHabits([habit({ category: "mind", archived_at: "x" })], {
        templates: t,
      })[0].reasons,
    ).toEqual(["category_gap"]);
  });

  it("rule 3: +15 once, when any default time hits an empty slot", () => {
    const user = [habit({ category: "mind", reminder_times: ["07:00"] })];
    const t = (times: string[]) => [
      tpl({ key: "a", category: "mind", defaultTimes: times }),
    ];
    // Morning is used; midday and evening are empty.
    expect(suggestHabits(user, { templates: t(["08:00"]) })).toEqual([]);
    expect(
      suggestHabits(user, { templates: t(["12:00", "18:00"]) })[0].score,
    ).toBe(SCORES.slotGap);
    // 23:00 is in no slot, so it can't fill a gap.
    expect(suggestHabits(user, { templates: t(["23:00"]) })).toEqual([]);
    // A template with no time never fills a slot gap.
    expect(suggestHabits(user, { templates: t([]) })).toEqual([]);
  });

  it("rule 3: a habit fills slots even with reminders off, but not with no times", () => {
    const t = [tpl({ key: "a", category: "mind", defaultTimes: ["08:00"] })];
    expect(
      suggestHabits([habit({ category: "mind", reminder_times: ["10:59"] })], {
        templates: t,
      }),
    ).toEqual([]);
    expect(
      suggestHabits([habit({ category: "mind", reminder_times: ["11:00"] })], {
        templates: t,
      })[0].reasons,
    ).toEqual(["slot_gap"]);
    expect(
      suggestHabits([habit({ category: "mind" })], { templates: t })[0].reasons,
    ).toEqual(["slot_gap"]);
  });

  it("rule 4: drops templates already added by key, even archived", () => {
    const s = suggestHabits([
      fromTemplate("workout", { title: "Lift", archived_at: "2026-11-01" }),
    ]);
    expect(keys(s)).not.toContain("workout");
  });

  it("rule 4: drops fuzzy title matches, even archived", () => {
    expect(
      keys(suggestHabits([habit({ title: "meditate 10 mins" })])),
    ).not.toContain("meditate");
    expect(
      keys(suggestHabits([habit({ title: "Meditate", archived_at: "x" })])),
    ).toContain("meditate");
    expect(
      keys(
        suggestHabits([habit({ title: "MEDITATE 10 MIN", archived_at: "x" })]),
      ),
    ).not.toContain("meditate");
  });

  it("rule 5: +10 for popular templates", () => {
    const t = [tpl({ key: "a", category: "mind" })];
    const s = suggestHabits([habit({ category: "mind" })], {
      templates: t,
      popularKeys: new Set(["a"]),
    });
    expect(s[0]).toMatchObject({ score: SCORES.popular, reasons: ["popular"] });
  });

  it("adds scores from different rules", () => {
    const s = suggestHabits([fromTemplate("workout")], {
      popularKeys: new Set(["stretch"]),
    });
    // Fitness is used, morning is empty: 40 + 15 + 10.
    expect(find(s, "stretch")).toMatchObject({
      score: 65,
      reasons: ["pair", "slot_gap", "popular"],
    });
  });

  it("returns only positive scores", () => {
    const s = suggestHabits([fromTemplate("workout")]);
    expect(s.every((x) => x.score > 0)).toBe(true);
    // Fitness used, evening used: nothing left for 8,000 steps (19:00).
    expect(keys(s)).not.toContain("steps_8000");
  });

  it("breaks ties by health > mind > fitness, then declaration order", () => {
    const s = suggestHabits([]);
    // Every template scores 25 + 15 except medication (no time) at 25.
    expect(s[0].template.category).toBe("health");
    expect(keys(s).slice(0, 6)).toEqual([
      "sleep_by_23",
      "make_bed",
      "meditate",
      "journal",
      "gratitude_list",
      "workout",
    ]);
    expect(keys(s).at(-1)).toBe("take_medication");
  });

  it("sorts by score before category", () => {
    // Stretch: pair + empty morning = 55, above any 25 + 15 = 40.
    const s = suggestHabits([fromTemplate("workout")]);
    expect(s[0].template.key).toBe("stretch");
  });
});

describe("coaching hints", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const draft = (over: Partial<HabitDraft> = {}): HabitDraft => ({
    title: "Read 20 pages",
    difficulty: "medium",
    target_per_day: 1,
    reminder_times: [],
    ...over,
  });
  const ctx = (n: number, over: Partial<CoachingContext> = {}) => ({
    activeHabits: Array.from({ length: n }, (_, i) => ({
      title: `Habit ${i}`,
      reminder_times: [] as string[],
    })),
    onboardedAt: new Date(now.getTime() - 24 * 3600 * 1000),
    now,
    ...over,
  });
  const kinds = (h: ReturnType<typeof coachingHints>) => h.map((x) => x.kind);

  it("gives no hints for a specific, moderate habit", () => {
    expect(coachingHints(draft(), ctx(2))).toEqual([]);
  });

  it("first week: warns when the new habit makes more than 5", () => {
    expect(kinds(coachingHints(draft(), ctx(4)))).toEqual([]);
    expect(kinds(coachingHints(draft(), ctx(5)))).toEqual([
      "first_week_overload",
    ]);
  });

  it("first week ends exactly 7 days after onboarding", () => {
    const just = new Date(now.getTime() - COACHING.firstWeekMs + 1);
    const over = new Date(now.getTime() - COACHING.firstWeekMs);
    expect(
      kinds(coachingHints(draft(), ctx(5, { onboardedAt: just }))),
    ).toEqual(["first_week_overload"]);
    expect(
      kinds(coachingHints(draft(), ctx(5, { onboardedAt: over }))),
    ).toEqual([]);
  });

  it("counts a user who hasn't onboarded as in their first week", () => {
    expect(
      kinds(coachingHints(draft(), ctx(5, { onboardedAt: null }))),
    ).toEqual(["first_week_overload"]);
  });

  it("warns more strongly above 8, at any time", () => {
    const old = { onboardedAt: new Date("2025-01-01") };
    expect(kinds(coachingHints(draft(), ctx(7, old)))).toEqual([]);
    expect(kinds(coachingHints(draft(), ctx(8, old)))).toEqual(["overload"]);
    // The stronger warning replaces the first-week one.
    expect(kinds(coachingHints(draft(), ctx(8)))).toEqual(["overload"]);
  });

  it("reports the hard cap at 20", () => {
    expect(kinds(coachingHints(draft(), ctx(19)))).toEqual(["overload"]);
    expect(kinds(coachingHints(draft(), ctx(20)))).toEqual(["at_cap"]);
  });

  it("skips count hints when editing", () => {
    expect(coachingHints(draft(), ctx(20, { editing: true }))).toEqual([]);
  });

  it.each([
    ["Study", true],
    ["Go running", true],
    ["  Study  ", true],
    ["Study for exams", false],
    ["Study 45", false],
    ["Run 5k", false],
    ["Sleep by 23:00", false],
    ["", false],
    ["   ", false],
  ])("vague title %j → %s", (title, vague) => {
    expect(isVagueTitle(title)).toBe(vague);
    expect(kinds(coachingHints(draft({ title }), ctx(0)))).toEqual(
      vague ? ["vague_title"] : [],
    );
  });

  it("suggests a specific rewrite of a vague title", () => {
    const [hint] = coachingHints(draft({ title: "Study" }), ctx(0));
    expect(hint.message).toContain('"Study 45 min for [goal]"');
  });

  describe("reminder collisions", () => {
    const withSupps = (over: Partial<CoachingContext> = {}) => ({
      ...ctx(0),
      activeHabits: [
        { title: "Take supplements", reminder_times: ["08:00", "20:00"] },
      ],
      ...over,
    });

    it.each([
      ["07:50", true],
      ["08:10", true],
      ["08:11", false],
      ["07:49", false],
      ["20:05", true],
    ])("%s vs 08:00/20:00 → %s", (time, hit) => {
      const h = coachingHints(draft({ reminder_times: [time] }), withSupps());
      expect(kinds(h)).toEqual(hit ? ["stack"] : []);
    });

    it("suggests stacking with the habit and time", () => {
      const [h] = coachingHints(
        draft({ title: "Floss every tooth", reminder_times: ["08:05"] }),
        withSupps(),
      );
      expect(h).toEqual({
        kind: "stack",
        message: "Stack it with Take supplements at 08:00?",
        anchor: { title: "Take supplements", time: "08:00" },
        stackingCopy: "After I take supplements, I will floss every tooth.",
      });
    });

    it("wraps at midnight", () => {
      const h = coachingHints(draft({ reminder_times: ["23:55"] }), {
        ...ctx(0),
        activeHabits: [{ title: "Late", reminder_times: ["00:05:00"] }],
      });
      expect(h[0]).toMatchObject({
        kind: "stack",
        anchor: { time: "00:05" },
      });
    });

    it("picks the closest anchor", () => {
      const h = coachingHints(draft({ reminder_times: ["08:00"] }), {
        ...ctx(0),
        activeHabits: [
          { title: "Far", reminder_times: ["08:09"] },
          { title: "Near", reminder_times: ["07:58"] },
        ],
      });
      expect(h[0]).toMatchObject({ anchor: { title: "Near" } });
    });

    it("ignores invalid times", () => {
      expect(
        coachingHints(draft({ reminder_times: ["8am"] }), withSupps()),
      ).toEqual([]);
    });
  });

  it.each([
    ["hard", 3, true],
    ["hard", 2, false],
    ["medium", 5, false],
    ["easy", 5, false],
  ] as const)("%s × %i → too_hard %s", (difficulty, target, hit) => {
    const h = coachingHints(
      draft({ difficulty, target_per_day: target }),
      ctx(0),
    );
    expect(kinds(h)).toEqual(hit ? ["too_hard"] : []);
  });

  it("orders hints: count, title, stack, difficulty", () => {
    const h = coachingHints(
      {
        title: "Gym",
        difficulty: "hard",
        target_per_day: 3,
        reminder_times: ["08:00"],
      },
      {
        ...ctx(8),
        activeHabits: [
          ...ctx(8).activeHabits,
          { title: "Coffee", reminder_times: ["08:00"] },
        ],
      },
    );
    expect(kinds(h)).toEqual(["overload", "vague_title", "stack", "too_hard"]);
  });
});

describe("stackingCopy", () => {
  it("builds the plan's sentence", () => {
    expect(stackingCopy("Meditate 10 min", "Journal 3 lines")).toBe(
      "After I meditate 10 min, I will journal 3 lines.",
    );
  });

  it("keeps acronyms and fills a blank title", () => {
    expect(stackingCopy("SPF", "  ")).toBe("After I SPF, I will [new habit].");
  });
});
