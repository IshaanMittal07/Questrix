import type { Database } from "@/lib/supabase/types";
import type { HabitCreateInput } from "@/lib/validation/habit";

/**
 * The habit template library (plan §8.1). Templates are static data: picking
 * one pre-fills the Add Habit form, and the resulting habit records the
 * template's key as `template_key` (untrusted analytics only, DECISIONS
 * § Phase 3).
 *
 * Icons are single-code-point emoji with no variation selector or ZWJ, so the
 * source has no invisible characters and habits_clean_text leaves them as is.
 */

export type HabitCategory = Database["public"]["Enums"]["habit_category"];
export type HabitDifficulty = Database["public"]["Enums"]["habit_difficulty"];

export type HabitTemplate = {
  /** Stable slug, stored as habits.template_key. Never rename one. */
  key: string;
  title: string;
  category: HabitCategory;
  difficulty: HabitDifficulty;
  icon: string;
  /** 0 = Sunday … 6 = Saturday. */
  defaultDays: readonly number[];
  targetPerDay: number;
  /** Local HH:MM. Empty when the user sets the time. */
  defaultTimes: readonly string[];
  tip: string;
};

const DAILY = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** In plan §8.1 table order, which is also the final suggestion tie-break. */
export const HABIT_TEMPLATES: readonly HabitTemplate[] = [
  // self_care
  {
    key: "night_skincare",
    title: "Night skincare routine",
    category: "self_care",
    difficulty: "easy",
    icon: "🌙",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["21:30"],
    tip: "Lay your products out in the order you use them.",
  },
  {
    key: "morning_skincare_spf",
    title: "Morning skincare + SPF",
    category: "self_care",
    difficulty: "easy",
    icon: "🧴",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["07:30"],
    tip: "Keep the SPF next to your toothbrush.",
  },
  {
    key: "floss",
    title: "Floss",
    category: "self_care",
    difficulty: "easy",
    icon: "🦷",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["22:00"],
    tip: "Start with one tooth. Momentum does the rest.",
  },
  {
    key: "screen_off_before_bed",
    title: "Screen-off 30 min before bed",
    category: "self_care",
    difficulty: "medium",
    icon: "📵",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["22:30"],
    tip: "Charge your phone outside the bedroom.",
  },
  // nutrition
  {
    key: "take_supplements",
    title: "Take supplements",
    category: "nutrition",
    difficulty: "easy",
    icon: "💊",
    defaultDays: DAILY,
    targetPerDay: 2,
    defaultTimes: ["08:00", "20:00"],
    tip: "Keep them where you eat breakfast.",
  },
  {
    key: "follow_diet_plan",
    title: "Follow my diet plan",
    category: "nutrition",
    difficulty: "hard",
    icon: "🥗",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["12:00"],
    tip: "Prep tomorrow's meals tonight.",
  },
  {
    key: "drink_water",
    title: "Drink 2 L of water",
    category: "nutrition",
    difficulty: "easy",
    icon: "💧",
    defaultDays: DAILY,
    targetPerDay: 4,
    defaultTimes: ["09:00", "12:00", "15:00", "18:00"],
    tip: "One 500 ml bottle per reminder gets you there.",
  },
  {
    key: "log_meals",
    title: "Log meals",
    category: "nutrition",
    difficulty: "medium",
    icon: "📒",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["20:00"],
    tip: "A photo of each meal is enough to log later.",
  },
  {
    key: "no_sugary_drinks",
    title: "No sugary drinks",
    category: "nutrition",
    difficulty: "medium",
    icon: "🥤",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["12:00"],
    tip: "Swap in sparkling water when the craving hits.",
  },
  // learning
  {
    key: "study_session",
    title: "Study session 45 min",
    category: "learning",
    difficulty: "hard",
    icon: "📚",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["18:00"],
    tip: "Decide what you'll study before the timer starts.",
  },
  {
    key: "review_flashcards",
    title: "Review flashcards 15 min",
    category: "learning",
    difficulty: "easy",
    icon: "🃏",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["07:45"],
    tip: "Short daily reviews beat one long cram.",
  },
  {
    key: "read_20_pages",
    title: "Read 20 pages",
    category: "learning",
    difficulty: "medium",
    icon: "📖",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["21:00"],
    tip: "Leave the book on your pillow.",
  },
  {
    key: "language_practice",
    title: "Language practice 15 min",
    category: "learning",
    difficulty: "medium",
    icon: "🔤",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["12:30"],
    tip: "Narrate your lunch in the language you're learning.",
  },
  // career
  {
    key: "push_commits",
    title: "Push commits to GitHub",
    category: "career",
    difficulty: "medium",
    icon: "💻",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["20:00"],
    tip: "A small commit counts. Ship something.",
  },
  {
    key: "practice_problem",
    title: "LeetCode / practice problem",
    category: "career",
    difficulty: "hard",
    icon: "🧩",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["19:00"],
    tip: "Pick tomorrow's problem before you stop today.",
  },
  {
    key: "plan_top_3",
    title: "Plan tomorrow's top 3 tasks",
    category: "career",
    difficulty: "easy",
    icon: "🎯",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["21:00"],
    tip: "If everything is a priority, nothing is.",
  },
  {
    key: "inbox_zero",
    title: "Inbox zero",
    category: "career",
    difficulty: "medium",
    icon: "📥",
    defaultDays: WEEKDAYS,
    targetPerDay: 1,
    defaultTimes: ["16:30"],
    tip: "Archive, reply, or schedule. Don't reread.",
  },
  // fitness
  {
    key: "workout",
    title: "Workout",
    category: "fitness",
    difficulty: "hard",
    icon: "💪",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["17:30"],
    tip: "Pack your gym bag the night before.",
  },
  {
    key: "steps_8000",
    title: "8,000 steps",
    category: "fitness",
    difficulty: "medium",
    icon: "👟",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["19:00"],
    tip: "Take calls on foot.",
  },
  {
    key: "stretch",
    title: "Stretch 10 min",
    category: "fitness",
    difficulty: "easy",
    icon: "🤸",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["07:15"],
    tip: "Stretch while the kettle boils.",
  },
  {
    key: "go_for_walk",
    title: "Go for a walk",
    category: "fitness",
    difficulty: "easy",
    icon: "🚶",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["13:00"],
    tip: "A lap around the block after lunch counts.",
  },
  // mind
  {
    key: "meditate",
    title: "Meditate 10 min",
    category: "mind",
    difficulty: "medium",
    icon: "🧘",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["07:00"],
    tip: "Same spot, same time, every day.",
  },
  {
    key: "journal",
    title: "Journal 3 lines",
    category: "mind",
    difficulty: "easy",
    icon: "📓",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["22:00"],
    tip: "What happened, how you felt, one thing you learned.",
  },
  {
    key: "gratitude_list",
    title: "Gratitude list",
    category: "mind",
    difficulty: "easy",
    icon: "🙏",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["21:45"],
    tip: "Three specific things beat three general ones.",
  },
  // health
  {
    key: "sleep_by_23",
    title: "Sleep by 23:00",
    category: "health",
    difficulty: "hard",
    icon: "😴",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["22:45"],
    tip: "Set an alarm for going to bed, not just waking up.",
  },
  {
    key: "take_medication",
    title: "Take medication",
    category: "health",
    difficulty: "easy",
    icon: "🩺",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: [],
    tip: "Set the reminder for when your prescription says.",
  },
  {
    key: "make_bed",
    title: "Make bed",
    category: "health",
    difficulty: "easy",
    icon: "🛌",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["07:20"],
    tip: "A first win before breakfast.",
  },
  // finance
  {
    key: "log_expenses",
    title: "Log expenses",
    category: "finance",
    difficulty: "easy",
    icon: "💸",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["20:30"],
    tip: "Two minutes now saves an hour at month end.",
  },
  {
    key: "no_spend_check",
    title: "No-spend check",
    category: "finance",
    difficulty: "medium",
    icon: "🐷",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["21:00"],
    tip: "Ask: did I buy only what I planned?",
  },
  // social
  {
    key: "message_someone",
    title: "Message a friend or family member",
    category: "social",
    difficulty: "easy",
    icon: "💬",
    defaultDays: DAILY,
    targetPerDay: 1,
    defaultTimes: ["18:30"],
    tip: "A two-line check-in is plenty.",
  },
];

const BY_KEY = new Map(HABIT_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): HabitTemplate | undefined {
  return BY_KEY.get(key);
}

/**
 * The habit-create input a template pre-fills. Parse it with
 * habitCreateSchema before inserting, as for any other input.
 */
export function templateToHabit(t: HabitTemplate): HabitCreateInput {
  return {
    title: t.title,
    category: t.category,
    difficulty: t.difficulty,
    icon: t.icon,
    days_of_week: [...t.defaultDays],
    target_per_day: t.targetPerDay,
    reminder_times: [...t.defaultTimes],
    // A template without a time has nothing to remind about yet.
    reminders_enabled: t.defaultTimes.length > 0,
    template_key: t.key,
  };
}
