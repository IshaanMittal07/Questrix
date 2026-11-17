import "server-only";

import type {
  CoachingInput,
  HabitFormValues,
  SuggestionView,
} from "@/components/habits/HabitForm";
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
 * Server-side inputs for the Add/Edit Habit form: suggestions (rules 1-4;
 * rule 5 arrives with Phase 7) and coaching context. `now` is fixed here so
 * the server and client renders compute the same hints.
 */
export async function habitFormContext(excludeId?: string): Promise<{
  suggestions: SuggestionView[];
  coaching: CoachingInput;
}> {
  const [active, archived, me] = await Promise.all([
    listActiveHabits(),
    listArchivedHabits(),
    getMyProfile(),
  ]);
  const suggestions = suggestHabits([...active, ...archived])
    .slice(0, SUGGESTIONS_SHOWN)
    .map((s) => ({
      key: s.template.key,
      reasons: s.reasons,
      ...(s.pairedWith !== undefined && { pairedWith: s.pairedWith }),
    }));
  return {
    suggestions,
    coaching: {
      activeHabits: active
        .filter((h) => h.id !== excludeId)
        .map((h) => ({ title: h.title, reminder_times: h.reminder_times })),
      onboardedAt: me?.profile.onboarded_at ?? null,
      now: new Date().toISOString(),
    },
  };
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
