import type { SuggestionReason } from "@/lib/habits/suggestions";
import type { HabitCategory, HabitDifficulty } from "@/lib/habits/templates";

/**
 * Shared habit UI types and labels. A plain module (not "use client"), so
 * server code can import the values too.
 */

export const CATEGORY_LABELS: Record<HabitCategory, string> = {
  health: "Health",
  fitness: "Fitness",
  mind: "Mind",
  learning: "Learning",
  career: "Career",
  self_care: "Self-care",
  nutrition: "Nutrition",
  finance: "Finance",
  social: "Social",
  other: "Other",
};

/** Human names for the colour tokens (screen readers read these). */
export const COLOR_LABELS: Record<string, string> = {
  cyan: "Cyan",
  violet: "Violet",
  magenta: "Magenta",
  success: "Green",
  warning: "Amber",
};

export const COLOR_SWATCH: Record<string, string> = {
  cyan: "bg-cyan",
  violet: "bg-violet",
  magenta: "bg-magenta",
  success: "bg-success",
  warning: "bg-warning",
};

export const ACCENT_BORDER: Record<string, string> = {
  cyan: "border-l-cyan",
  violet: "border-l-violet",
  magenta: "border-l-magenta",
  success: "border-l-success",
  warning: "border-l-warning",
};

export const REASON_LABELS: Record<SuggestionReason, string> = {
  pair: "Pairs well",
  category_gap: "New area",
  slot_gap: "Fills a gap in your day",
  popular: "Popular with friends",
};

export type HabitFormValues = {
  title: string;
  description: string;
  icon: string;
  category: HabitCategory;
  difficulty: HabitDifficulty;
  color: string | null;
  days_of_week: number[];
  target_per_day: number;
  reminder_times: string[];
  reminders_enabled: boolean;
};

export type SuggestionView = {
  key: string;
  reasons: SuggestionReason[];
  pairedWith?: string;
};

export type CoachingInput = {
  activeHabits: { title: string; reminder_times: string[] }[];
  /** ISO timestamps, from the server so both renders agree. */
  onboardedAt: string | null;
  now: string;
};

/** The fields the habits list renders; the server sends only these. */
export type HabitListItem = {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  days_of_week: number[];
  target_per_day: number;
  reminder_times: string[];
  reminders_enabled: boolean;
};
