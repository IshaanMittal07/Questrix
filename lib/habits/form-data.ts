import "server-only";

import type {
  CoachingInput,
  HabitFormValues,
  HabitListItem,
  SuggestionView,
} from "@/lib/habits/display";
import {
  listActiveHabits,
  listArchivedHabits,
  type Habit,
} from "@/lib/habits/queries";
import { suggestHabits } from "@/lib/habits/suggestions";
import type { HabitCategory } from "@/lib/habits/templates";
import { getMyProfile } from "@/lib/profile/queries";

export const SUGGESTIONS_SHOWN = 6;

/**
 * Coaching context for the Add/Edit form. `now` is fixed here so the server
 * and client renders compute the same hints. The habit being edited is left
 * out, so it can't collide with its own reminders.
 */
export async function coachingContext(
  excludeId?: string,
): Promise<CoachingInput> {
  const [active, me] = await Promise.all([listActiveHabits(), getMyProfile()]);
  return {
    activeHabits: active
      .filter((h) => h.id !== excludeId)
      .map((h) => ({ title: h.title, reminder_times: h.reminder_times })),
    onboardedAt: me?.profile.onboarded_at ?? null,
    now: new Date().toISOString(),
  };
}

/** Suggestions for the Add form (rules 1-4; rule 5 arrives in Phase 7). */
export async function suggestionsForMe(): Promise<SuggestionView[]> {
  const [active, archived] = await Promise.all([
    listActiveHabits(),
    listArchivedHabits(),
  ]);
  return suggestHabits([...active, ...archived])
    .slice(0, SUGGESTIONS_SHOWN)
    .map((s) => ({
      key: s.template.key,
      reasons: s.reasons,
      ...(s.pairedWith !== undefined && { pairedWith: s.pairedWith }),
    }));
}

export function toFormValues(h: Habit): HabitFormValues {
  return {
    title: h.title,
    description: h.description ?? "",
    icon: h.icon ?? "",
    category: h.category as HabitCategory,
    difficulty: h.difficulty,
    color: h.color,
    days_of_week: h.days_of_week,
    target_per_day: h.target_per_day,
    reminder_times: h.reminder_times.map((t) => t.slice(0, 5)),
    reminders_enabled: h.reminders_enabled,
  };
}

/** Only what the list renders goes to the client. */
export function toListItem(h: Habit): HabitListItem {
  return {
    id: h.id,
    title: h.title,
    icon: h.icon,
    color: h.color,
    days_of_week: h.days_of_week,
    target_per_day: h.target_per_day,
    reminder_times: h.reminder_times,
    reminders_enabled: h.reminders_enabled,
  };
}
