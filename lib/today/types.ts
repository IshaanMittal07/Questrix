import { z } from "zod";

/**
 * The shapes the engine RPCs return (BUILD_PLAN §6.4). Parsed, not cast: the
 * Today screen trusts these numbers for display, so a server change that
 * breaks the contract fails loudly here instead of rendering NaN.
 */

const completionSchema = z.object({
  id: z.string(),
  occurrence: z.number().int(),
  points_awarded: z.number().int(),
  // Postgres sends microseconds and an offset; reject anything Date.parse
  // might not read, rather than silently hiding Undo on NaN.
  completed_at: z.iso.datetime({ offset: true }),
  undoable_until: z.iso.datetime({ offset: true }),
});

const todayHabitSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  difficulty: z.string(),
  target: z.number().int(),
  done: z.number().int(),
  habit_streak: z.number().int(),
  // #82: joined today after the day's first snapshot (added, unarchived or
  // rescheduled); completing it doesn't count the day for the streak.
  joined_late: z.boolean(),
  completions: z.array(completionSchema),
});

export const todaySchema = z.object({
  local_date: z.string(),
  local_hour: z.number().int(),
  timezone: z.string(),
  username: z.string(),
  display_name: z.string().nullable(),
  points_balance: z.number().int(),
  lifetime_points: z.number().int(),
  level: z.number().int(),
  current_streak: z.number().int(),
  longest_streak: z.number().int(),
  streak_freezes: z.number().int(),
  freezes_needed: z.number().int(),
  counted_today: z.boolean(),
  // #81: a day already passed in an earlier timezone (after a move west).
  relived: z.boolean(),
  scheduled_count: z.number().int(),
  completed_count: z.number().int(),
  at_risk: z.boolean(),
  undo_window_minutes: z.number().int(),
  // #116: completion points earned today and the daily cap. Optional so a
  // client deployed before the migration still parses.
  points_today: z.number().int().optional(),
  daily_points_cap: z.number().int().optional(),
  habits: z.array(todayHabitSchema),
});

export const completeEventSchema = z.object({
  completion_id: z.string(),
  occurrence: z.number().int(),
  target: z.number().int(),
  points_awarded: z.number().int(),
  multiplier: z.number(),
  // #116: the award was cut by the daily cap (down to 0).
  points_capped: z.boolean().optional(),
  points_today: z.number().int().optional(),
  daily_points_cap: z.number().int().optional(),
  current_streak: z.number().int(),
  habit_streak: z.number().int(),
  milestone: z.number().int().nullable(),
  milestone_points: z.number().int().nullable(),
});

export const undoEventSchema = z.object({
  undone_id: z.string(),
  habit_id: z.string(),
  points_removed: z.number().int(),
  milestones_revoked: z.array(z.number().int()).nullable(),
  milestone_points_removed: z.number().int(),
});

export type Today = z.infer<typeof todaySchema>;
export type TodayHabit = Today["habits"][number];
export type TodayCompletion = TodayHabit["completions"][number];
export type CompleteEvent = z.infer<typeof completeEventSchema>;
export type UndoEvent = z.infer<typeof undoEventSchema>;
