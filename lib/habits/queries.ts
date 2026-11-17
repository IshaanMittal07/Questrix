import "server-only";

import { cache } from "react";

import { getVerifiedUser } from "@/lib/supabase/session";
import type { Database } from "@/lib/supabase/types";
import { habitIdSchema } from "@/lib/validation/habit";

export type Habit = Omit<
  Database["public"]["Tables"]["habits"]["Row"],
  "user_id"
>;

const HABIT_COLUMNS =
  "id, title, description, category, difficulty, icon, color, days_of_week, target_per_day, reminder_times, reminders_enabled, template_key, sort_order, archived_at, created_at";

/**
 * Habits are never deleted, so the archived list grows. Lists and the
 * suggestion engine's "already added" filter see the most recent ones only.
 */
export const ARCHIVED_LIST_MAX = 200;

// Signed out returns empty rather than throwing: the proxy already sends
// signed-out visitors on /habits and /onboarding to /login.

/**
 * The signed-in user's active habits in list order (sort_order, created_at,
 * id). RLS scopes rows to the user; the user_id filter matches the partial
 * index. Throws on a database error so the route's error boundary shows it.
 */
export const listActiveHabits = cache(async (): Promise<Habit[]> => {
  const s = await getVerifiedUser();
  if (!s) return [];
  const { data, error } = await s.supabase
    .from("habits")
    .select(HABIT_COLUMNS)
    .eq("user_id", s.userId)
    .is("archived_at", null)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (error) throw new Error(`Couldn't load habits: ${error.message}`);
  return data;
});

/** The most recently archived habits, newest first. */
export const listArchivedHabits = cache(async (): Promise<Habit[]> => {
  const s = await getVerifiedUser();
  if (!s) return [];
  const { data, error } = await s.supabase
    .from("habits")
    .select(HABIT_COLUMNS)
    .eq("user_id", s.userId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .order("id")
    .limit(ARCHIVED_LIST_MAX);
  if (error) throw new Error(`Couldn't load habits: ${error.message}`);
  return data;
});

/** One of the user's habits (active or archived), or null. */
export const getMyHabit = cache(async (id: string): Promise<Habit | null> => {
  // A malformed id (e.g. from a URL) is "not found", not a uuid cast error.
  const parsed = habitIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const s = await getVerifiedUser();
  if (!s) return null;
  const { data, error } = await s.supabase
    .from("habits")
    .select(HABIT_COLUMNS)
    .eq("user_id", s.userId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the habit: ${error.message}`);
  return data;
});
