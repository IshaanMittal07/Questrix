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

  it("pins every template's title and default times to plan §8.1", () => {
    const byKey = Object.fromEntries(
      HABIT_TEMPLATES.map((t) => [t.key, [t.title, t.defaultTimes]]),
    );
    expect(byKey).toEqual({
      night_skincare: ["Night skincare routine", ["21:30"]],
      morning_skincare_spf: ["Morning skincare + SPF", ["07:30"]],
      floss: ["Floss", ["22:00"]],
      screen_off_before_bed: ["Screen-off 30 min before bed", ["22:30"]],
      take_supplements: ["Take supplements", ["08:00", "20:00"]],
      follow_diet_plan: ["Follow my diet plan", ["12:00"]],
      drink_water: ["Drink 2 L of water", ["09:00", "12:00", "15:00", "18:00"]],
      log_meals: ["Log meals", ["20:00"]],
      no_sugary_drinks: ["No sugary drinks", ["12:00"]],
      study_session: ["Study session 45 min", ["18:00"]],
      review_flashcards: ["Review flashcards 15 min", ["07:45"]],
      read_20_pages: ["Read 20 pages", ["21:00"]],
      language_practice: ["Language practice 15 min", ["12:30"]],
      push_commits: ["Push commits to GitHub", ["20:00"]],
      practice_problem: ["LeetCode / practice problem", ["19:00"]],
      plan_top_3: ["Plan tomorrow's top 3 tasks", ["21:00"]],
      inbox_zero: ["Inbox zero", ["16:30"]],
      workout: ["Workout", ["17:30"]],
      steps_8000: ["8,000 steps", ["19:00"]],
      stretch: ["Stretch 10 min", ["07:15"]],
      go_for_walk: ["Go for a walk", ["13:00"]],
      meditate: ["Meditate 10 min", ["07:00"]],
      journal: ["Journal 3 lines", ["22:00"]],
      gratitude_list: ["Gratitude list", ["21:45"]],
      sleep_by_23: ["Sleep by 23:00", ["22:45"]],
      take_medication: ["Take medication", []],
      make_bed: ["Make bed", ["07:20"]],
      log_expenses: ["Log expenses", ["20:30"]],
      no_spend_check: ["No-spend check", ["21:00"]],
      message_someone: ["Message a friend or family member", ["18:30"]],
    });
  });

  it("no two template titles are fuzzy duplicates of each other", () => {
    // Otherwise adding one template would hide another through rule 4.
    for (const a of HABIT_TEMPLATES) {
      for (const b of HABIT_TEMPLATES) {
        if (a !== b) expect(isDuplicateTitle(a.title, b.title)).toBe(false);
      }
    }
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

  it("rule 1 also matches a hand-typed title, as rule 4 does", () => {
    const s = suggestHabits([habit({ title: "workout", category: "fitness" })]);
    expect(find(s, "stretch")).toMatchObject({
      reasons: expect.arrayContaining(["pair"]),
      pairedWith: "workout",
    });
    expect(
      find(suggestHabits([habit({ title: "Weightlifting" })]), "stretch")
        ?.reasons,
    ).not.toContain("pair");
  });

  it("rule 4 handles many archived duplicates", () => {
    const archived = Array.from({ length: 2000 }, (_, i) =>
      habit({
        title: i % 2 ? "Old habit" : `Old habit ${i}`,
        archived_at: "x",
      }),
    );
    archived.push(habit({ title: "meditate 10 min", archived_at: "x" }));
    expect(keys(suggestHabits(archived))).not.toContain("meditate");
  });

  it("rule 1 counts once even if two habits trigger it", () => {
    const s = suggestHabits(
      [fromTemplate("workout"), fromTemplate("workout", { title: "Gym" })],
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

  it("rule 1: pairedWith names the active trigger, never an archived one", () => {
    const t = { templates: [tpl({ key: "stretch", category: "fitness" })] };
    expect(
      suggestHabits(
        [
          fromTemplate("workout", { title: "Old gym", archived_at: "x" }),
          fromTemplate("workout", { title: "Lift weights" }),
        ],
        t,
      )[0].pairedWith,
    ).toBe("Lift weights");
    // Two active triggers: the first one is named.
    expect(
      suggestHabits(
        [
          fromTemplate("workout", { title: "Gym" }),
          fromTemplate("workout", { title: "Lift weights" }),
        ],
        t,
      )[0].pairedWith,
    ).toBe("Gym");
  });

  it("rule 4 overrides rule 1: an owned pair target is never suggested", () => {
    const s = suggestHabits([
      fromTemplate("workout"),
      fromTemplate("stretch", { title: "Yoga", archived_at: "x" }),
    ]);
    expect(keys(s)).not.toContain("stretch");
  });

  it("rule 1: suggestions without a pair carry no pairedWith", () => {
    expect(suggestHabits([]).every((x) => !("pairedWith" in x))).toBe(true);
  });

  it.each(["23:00", "23:59", "00:00", "04:59"])(
    "rule 3: a night-time reminder (%s) fills no slot",
    (time) => {
      const t = [tpl({ key: "a", category: "mind", defaultTimes: ["08:00"] })];
      expect(
        suggestHabits([habit({ category: "mind", reminder_times: [time] })], {
          templates: t,
        })[0].reasons,
      ).toEqual(["slot_gap"]);
    },
  );

  it("rule 3: an archived habit leaves its slot empty", () => {
    const t = [tpl({ key: "a", category: "mind", defaultTimes: ["08:00"] })];
    expect(
      suggestHabits(
        [
          habit({ category: "mind" }),
          habit({
            category: "mind",
            reminder_times: ["08:00"],
            archived_at: "x",
          }),
        ],
        { templates: t },
      )[0].reasons,
    ).toEqual(["slot_gap"]);
  });

  it("rule 3: one habit can fill several slots", () => {
    const user = [
      habit({ category: "mind", reminder_times: ["07:00", "12:00"] }),
    ];
    const t = (times: string[]) => [
      tpl({ key: "a", category: "mind", defaultTimes: times }),
    ];
    expect(suggestHabits(user, { templates: t(["07:00", "12:00"]) })).toEqual(
      [],
    );
    expect(
      suggestHabits(user, { templates: t(["07:00", "17:00"]) })[0].reasons,
    ).toEqual(["slot_gap"]);
  });

  it("rule 5: no bonus without popularKeys or for keys not in the set", () => {
    const t = [tpl({ key: "a", category: "mind" })];
    const user = [habit({ category: "mind" })];
    expect(suggestHabits(user, { templates: t })).toEqual([]);
    expect(
      suggestHabits(user, { templates: t, popularKeys: new Set(["b"]) }),
    ).toEqual([]);
  });

  it("rule 5 never brings back a template removed by rule 4", () => {
    const s = suggestHabits([fromTemplate("workout", { archived_at: "x" })], {
      popularKeys: new Set(["workout"]),
    });
    expect(keys(s)).not.toContain("workout");
  });

  it("applies the category tie-break across the whole list", () => {
    const order = [
      "health",
      "mind",
      "fitness",
      "self_care",
      "nutrition",
      "learning",
      "career",
      "finance",
      "social",
    ];
    const tied = suggestHabits([]).filter(
      (x) => x.score === SCORES.categoryGap + SCORES.slotGap,
    );
    const ranks = tied.map((x) => order.indexOf(x.template.category));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
    // Within a category, declaration order holds.
    const libOrder = HABIT_TEMPLATES.map((t) => t.key);
    for (const c of order) {
      const k = keys(tied.filter((x) => x.template.category === c));
      expect(k).toEqual(libOrder.filter((key) => k.includes(key)));
    }
  });

  it("does not mutate its inputs", () => {
    const h = [fromTemplate("workout")];
    const t = [...HABIT_TEMPLATES];
    const before = JSON.stringify([h, t]);
    suggestHabits(h, { templates: t });
    expect(JSON.stringify([h, t])).toBe(before);
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

  it("uses the plan's copy for the count and difficulty hints", () => {
    const old = { onboardedAt: new Date("2025-01-01") };
    expect(coachingHints(draft(), ctx(5))[0].message).toBe(
      "Starting with 3–5 habits makes streaks 2× easier to keep. Add anyway?",
    );
    expect(coachingHints(draft(), ctx(8, old))[0].message).toContain(
      "That's 9 habits.",
    );
    expect(coachingHints(draft(), ctx(20))[0].message).toContain(
      "limit of 20 active habits",
    );
    expect(
      coachingHints(draft({ difficulty: "hard", target_per_day: 3 }), ctx(0))[0]
        .message,
    ).toBe("This is a lot — consider medium difficulty or fewer reps.");
  });

  it("keeps reporting the cap above 20", () => {
    expect(kinds(coachingHints(draft(), ctx(21)))).toEqual(["at_cap"]);
  });

  it("counts a future onboarded_at (clock skew) as the first week", () => {
    const future = new Date(now.getTime() + 3600 * 1000);
    expect(
      kinds(coachingHints(draft(), ctx(5, { onboardedAt: future }))),
    ).toEqual(["first_week_overload"]);
  });

  it("still gives title, stack and difficulty hints when editing", () => {
    const h = coachingHints(
      {
        title: "Gym",
        difficulty: "hard",
        target_per_day: 3,
        reminder_times: ["08:00"],
      },
      {
        ...ctx(20, { editing: true }),
        activeHabits: [{ title: "Coffee", reminder_times: ["08:00"] }],
      },
    );
    expect(kinds(h)).toEqual(["vague_title", "stack", "too_hard"]);
  });

  it.each([
    [`Study ${String.fromCodePoint(0x664, 0x665)}`, false],
    [`Read ${String.fromCodePoint(0xbd)}`, false],
    ["Go\trunning", true],
    ["Go for a run", false],
  ])("vague title (non-ASCII digits, tabs) %j → %s", (title, vague) => {
    expect(isVagueTitle(title)).toBe(vague);
  });

  it("suggests a specific rewrite of a vague title", () => {
    const [hint] = coachingHints(draft({ title: "Study" }), ctx(0));
    expect(hint.message).toBe(
      'Specific habits stick. Add an amount or a time, like "Study 45 min for [exam]".',
    );
  });

  it("never calls a library template title vague", () => {
    for (const t of HABIT_TEMPLATES) {
      expect(isVagueTitle(t.title)).toBe(false);
      expect(isVagueTitle(t.title.toUpperCase())).toBe(false);
    }
  });

  it("ignores emoji-only titles and invisible characters", () => {
    expect(isVagueTitle(String.fromCodePoint(0x1f4aa))).toBe(false);
    // Cleaned before the template lookup: "Floss" + ZWSP is still "Floss".
    expect(isVagueTitle(`Floss${String.fromCodePoint(0x200b)}`)).toBe(false);
    expect(isVagueTitle(String.fromCodePoint(0x200b))).toBe(false);
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

    it.each([
      ["23:50", "00:00", true],
      ["23:49", "00:00", false],
      ["00:09", "23:59", true],
      ["00:10", "23:59", false],
    ])("midnight boundary %s vs %s → %s", (mine, theirs, hit) => {
      const h = coachingHints(draft({ reminder_times: [mine] }), {
        ...ctx(0),
        activeHabits: [{ title: "Late", reminder_times: [theirs] }],
      });
      expect(kinds(h)).toEqual(hit ? ["stack"] : []);
    });

    it("picks the closest anchor across all of the draft's times", () => {
      const h = coachingHints(
        draft({ reminder_times: ["07:52", "20:01"] }),
        withSupps(),
      );
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ anchor: { time: "20:00" } });
    });

    it("ignores invalid times on existing habits", () => {
      const h = coachingHints(draft({ reminder_times: ["08:00"] }), {
        ...ctx(0),
        activeHabits: [{ title: "Bad", reminder_times: ["8:00", "25:00"] }],
      });
      expect(h).toEqual([]);
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

  it("keeps mixed-case words and a leading I", () => {
    expect(stackingCopy("LeetCode / practice problem", "I stretch")).toBe(
      "After I LeetCode / practice problem, I will I stretch.",
    );
    expect(stackingCopy("GitHub push", "Floss")).toBe(
      "After I GitHub push, I will floss.",
    );
  });

  it("strips invisible characters", () => {
    expect(stackingCopy("Floss", `${String.fromCodePoint(0x200b)}Read`)).toBe(
      "After I floss, I will read.",
    );
  });
});
