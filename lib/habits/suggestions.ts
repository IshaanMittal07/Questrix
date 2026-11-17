import {
  getTemplate,
  HABIT_TEMPLATES,
  type HabitCategory,
  type HabitDifficulty,
  type HabitTemplate,
} from "@/lib/habits/templates";
import { cleanHabitText, HABIT_LIMITS } from "@/lib/validation/habit";

/**
 * Suggestion engine and coaching hints (plan §8.2). Pure functions, no I/O.
 * The details the plan leaves open are pinned in DECISIONS § Phase 3.
 */

/** The fields of a user's habit the engine reads (a habits row fits). */
export type ExistingHabit = {
  title: string;
  category: HabitCategory;
  template_key: string | null;
  reminder_times: readonly string[];
  archived_at: string | null;
};

export const SCORES = {
  pair: 40,
  categoryGap: 25,
  slotGap: 15,
  popular: 10,
} as const;

/** Rule 1: if the user has the key on the left, suggest the one on the right. */
export const COMPLEMENTARY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["night_skincare", "morning_skincare_spf"],
  ["study_session", "review_flashcards"],
  ["push_commits", "plan_top_3"],
  ["workout", "stretch"],
  ["follow_diet_plan", "log_meals"],
  ["take_supplements", "drink_water"],
];

/** Global tie-break: the plan's rule-2 priority, then §8.1 table order. */
export const CATEGORY_PRIORITY: readonly HabitCategory[] = [
  "health",
  "mind",
  "fitness",
  "self_care",
  "nutrition",
  "learning",
  "career",
  "finance",
  "social",
  "other",
];

export type Slot = "morning" | "midday" | "evening";

/** Half-open, in minutes since local midnight. 23:00-05:00 is in no slot. */
const SLOTS: ReadonlyArray<readonly [Slot, number, number]> = [
  ["morning", 5 * 60, 11 * 60],
  ["midday", 11 * 60, 17 * 60],
  ["evening", 17 * 60, 23 * 60],
];

/** Minutes since midnight for "HH:MM" (seconds ignored), or null if invalid. */
export function toMinutes(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function slotOf(time: string): Slot | null {
  const min = toMinutes(time);
  if (min === null) return null;
  for (const [slot, from, to] of SLOTS) {
    if (min >= from && min < to) return slot;
  }
  return null;
}

/** NFKC, lowercased, trimmed, internal whitespace collapsed. */
export function normalizeTitle(title: string) {
  return title.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}

/** Edit distance over code points. */
export function levenshtein(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 1 − distance / longer length, on normalised titles. Identical = 1. */
export function titleSimilarity(a: string, b: string) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  const len = Math.max([...na].length, [...nb].length);
  if (len === 0) return 1;
  return 1 - levenshtein(na, nb) / len;
}

export const DUPLICATE_THRESHOLD = 0.8;

/** A title normalised once, for many comparisons. */
type PreparedTitle = { norm: string; len: number };

function prepareTitle(title: string): PreparedTitle {
  const norm = normalizeTitle(title);
  return { norm, len: [...norm].length };
}

/** Same result as titleSimilarity(a, b) > 0.8, without needless work. */
function preparedDuplicate(a: PreparedTitle, b: PreparedTitle) {
  if (a.norm === b.norm) return true;
  const len = Math.max(a.len, b.len);
  // The distance is at least the length difference, which bounds similarity.
  if (1 - Math.abs(a.len - b.len) / len <= DUPLICATE_THRESHOLD) return false;
  return 1 - levenshtein(a.norm, b.norm) / len > DUPLICATE_THRESHOLD;
}

export function isDuplicateTitle(a: string, b: string) {
  return preparedDuplicate(prepareTitle(a), prepareTitle(b));
}

export type SuggestionReason = "pair" | "category_gap" | "slot_gap" | "popular";

export type Suggestion = {
  template: HabitTemplate;
  score: number;
  reasons: SuggestionReason[];
  /**
   * Title of the user's habit that triggered rule 1, for "Pairs with …".
   * User content: render it as text, never as HTML.
   */
  pairedWith?: string;
};

export type SuggestOptions = {
  /** Rule 5 (Phase 7+): template keys popular among people the user follows. */
  popularKeys?: ReadonlySet<string>;
  /** Defaults to the full library. */
  templates?: readonly HabitTemplate[];
};

/**
 * Templates to suggest, best first. Only templates with a positive score are
 * returned: the template library itself lists everything else.
 */
export function suggestHabits(
  habits: readonly ExistingHabit[],
  { popularKeys, templates = HABIT_TEMPLATES }: SuggestOptions = {},
): Suggestion[] {
  const active = habits.filter((h) => h.archived_at === null);

  // "Has X" means X's key or a fuzzy match of X's title, as in rule 4.
  const activeTitles = active.map((h) => ({ h, p: prepareTitle(h.title) }));
  const pairedBy = new Map<string, string>();
  for (const [from, to] of COMPLEMENTARY_PAIRS) {
    if (pairedBy.has(to)) continue;
    const fromTitle = prepareTitle(getTemplate(from)?.title ?? "");
    const owner = activeTitles.find(
      ({ h, p }) =>
        h.template_key === from ||
        (fromTitle.len > 0 && preparedDuplicate(p, fromTitle)),
    );
    if (owner) pairedBy.set(to, owner.h.title);
  }

  const usedCategories = new Set(active.map((h) => h.category));
  const usedSlots = new Set<Slot>();
  for (const h of active) {
    for (const t of h.reminder_times) {
      const s = slotOf(t);
      if (s) usedSlots.add(s);
    }
  }

  // Rule 4 counts archived habits too, so archived ones aren't re-suggested.
  const ownedKeys = new Set(
    habits.flatMap((h) => (h.template_key ? [h.template_key] : [])),
  );
  // Archived habits pile up over time: normalise and de-duplicate once.
  const ownedTitles = [
    ...new Map(
      habits.map((h) => {
        const p = prepareTitle(h.title);
        return [p.norm, p] as const;
      }),
    ).values(),
  ];

  const out: Suggestion[] = [];
  for (const template of templates) {
    if (ownedKeys.has(template.key)) continue;
    const title = prepareTitle(template.title);
    if (ownedTitles.some((t) => preparedDuplicate(t, title))) continue;

    const reasons: SuggestionReason[] = [];
    let score = 0;
    const pairedWith = pairedBy.get(template.key);
    if (pairedWith !== undefined) {
      score += SCORES.pair;
      reasons.push("pair");
    }
    if (!usedCategories.has(template.category)) {
      score += SCORES.categoryGap;
      reasons.push("category_gap");
    }
    if (
      template.defaultTimes.some((t) => {
        const s = slotOf(t);
        return s !== null && !usedSlots.has(s);
      })
    ) {
      score += SCORES.slotGap;
      reasons.push("slot_gap");
    }
    if (popularKeys?.has(template.key)) {
      score += SCORES.popular;
      reasons.push("popular");
    }
    if (score > 0) {
      out.push({
        template,
        score,
        reasons,
        ...(pairedWith !== undefined && { pairedWith }),
      });
    }
  }

  const rank = (c: HabitCategory) => CATEGORY_PRIORITY.indexOf(c);
  // Array.prototype.sort is stable, so equal ranks keep declaration order.
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      rank(a.template.category) - rank(b.template.category),
  );
}

// ---------------------------------------------------------------------------
// Coaching hints (inline, never blocking)
// ---------------------------------------------------------------------------

export const COACHING = {
  firstWeekMax: 5,
  overloadMax: 8,
  firstWeekMs: 7 * 24 * 60 * 60 * 1000,
  stackWindowMin: 10,
  hardTargetMax: 2,
  vagueMaxWords: 2,
} as const;

export type HabitDraft = {
  title: string;
  difficulty: HabitDifficulty;
  target_per_day: number;
  reminder_times: readonly string[];
};

export type CoachingContext = {
  /** The user's active habits, without the one being edited. */
  activeHabits: ReadonlyArray<{
    title: string;
    reminder_times: readonly string[];
  }>;
  /** profiles.onboarded_at; null (still onboarding) counts as the first week. */
  onboardedAt: Date | null;
  now: Date;
  /** Editing an existing habit: the habit-count hints don't apply. */
  editing?: boolean;
};

export type CoachingHint =
  | { kind: "at_cap"; message: string }
  | { kind: "overload"; message: string }
  | { kind: "first_week_overload"; message: string }
  | { kind: "vague_title"; message: string }
  | {
      kind: "stack";
      message: string;
      anchor: { title: string; time: string };
      /** "After I [existing habit], I will [new habit]." */
      stackingCopy: string;
    }
  | { kind: "too_hard"; message: string };

const DIGIT_RE = /\p{N}/u;
const LETTER_RE = /\p{L}/u;
const TEMPLATE_TITLES = new Set(
  HABIT_TEMPLATES.map((t) => normalizeTitle(t.title)),
);

/**
 * ≤ 2 words with a letter and no number or time, e.g. "Study". Blank,
 * emoji-only and library template titles are not vague.
 */
export function isVagueTitle(title: string) {
  const t = cleanHabitText(title);
  const words = t.split(/\s+/u).filter(Boolean);
  return (
    words.length > 0 &&
    words.length <= COACHING.vagueMaxWords &&
    LETTER_RE.test(t) &&
    !DIGIT_RE.test(t) &&
    !TEMPLATE_TITLES.has(normalizeTitle(t))
  );
}

/** Minutes between two times of day, wrapping at midnight. */
function clockDistance(a: number, b: number) {
  const d = Math.abs(a - b);
  return Math.min(d, 24 * 60 - d);
}

/**
 * Lowercases the first letter, unless the first word has capitals after it
 * (SPF, LeetCode) or is "I".
 */
function asClause(title: string) {
  const t = cleanHabitText(title);
  const word = t.split(/\s/u)[0];
  const [first] = [...word];
  if (!first || word === "I" || /\p{Lu}/u.test(word.slice(first.length)))
    return t;
  return first.toLowerCase() + t.slice(first.length);
}

export function stackingCopy(existing: string, next: string) {
  const n = cleanHabitText(next) ? asClause(next) : "[new habit]";
  return `After I ${asClause(existing)}, I will ${n}.`;
}

/** Inline hints for the Add/Edit Habit form, most important first. */
export function coachingHints(
  draft: HabitDraft,
  ctx: CoachingContext,
): CoachingHint[] {
  const hints: CoachingHint[] = [];
  const count = ctx.activeHabits.length;

  if (!ctx.editing) {
    const firstWeek =
      ctx.onboardedAt === null ||
      ctx.now.getTime() - ctx.onboardedAt.getTime() < COACHING.firstWeekMs;
    if (count >= HABIT_LIMITS.activeMax) {
      hints.push({
        kind: "at_cap",
        message: `You've reached the limit of ${HABIT_LIMITS.activeMax} active habits. Archive one to add another.`,
      });
    } else if (count + 1 > COACHING.overloadMax) {
      hints.push({
        kind: "overload",
        message: `That's ${count + 1} habits. More habits means more streaks to break. Consider archiving one you're not using.`,
      });
    } else if (firstWeek && count + 1 > COACHING.firstWeekMax) {
      hints.push({
        kind: "first_week_overload",
        message:
          "Starting with 3–5 habits makes streaks 2× easier to keep. Add anyway?",
      });
    }
  }

  if (isVagueTitle(draft.title)) {
    hints.push({
      kind: "vague_title",
      message:
        'Specific habits stick. Add an amount or a time, like "Study 45 min for [exam]".',
    });
  }

  let best: { title: string; time: string; distance: number } | null = null;
  for (const time of draft.reminder_times) {
    const mine = toMinutes(time);
    if (mine === null) continue;
    for (const h of ctx.activeHabits) {
      for (const theirs of h.reminder_times) {
        const m = toMinutes(theirs);
        if (m === null) continue;
        const distance = clockDistance(mine, m);
        if (
          distance <= COACHING.stackWindowMin &&
          (best === null || distance < best.distance)
        ) {
          best = { title: h.title, time: theirs.slice(0, 5), distance };
        }
      }
    }
  }
  if (best) {
    hints.push({
      kind: "stack",
      message: `Stack it with ${best.title} at ${best.time}?`,
      anchor: { title: best.title, time: best.time },
      stackingCopy: stackingCopy(best.title, draft.title),
    });
  }

  if (
    draft.difficulty === "hard" &&
    draft.target_per_day > COACHING.hardTargetMax
  ) {
    hints.push({
      kind: "too_hard",
      message: "This is a lot — consider medium difficulty or fewer reps.",
    });
  }

  return hints;
}
