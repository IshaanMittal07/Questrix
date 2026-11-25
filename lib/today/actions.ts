"use server";

import "server-only";

import { DEADLOCK, RETRY_MESSAGE } from "@/lib/supabase/errors";
import { getVerifiedUser } from "@/lib/supabase/session";
import { loadToday } from "@/lib/today/queries";
import {
  completeEventSchema,
  undoEventSchema,
  type CompleteEvent,
  type Today,
  type UndoEvent,
} from "@/lib/today/types";
import { habitIdSchema, uuidSchema } from "@/lib/validation/habit";

/**
 * Complete and undo for the Today screen. The engine RPCs do all the work
 * (points, streaks and undo are server-authoritative); these validate the id,
 * map refusals by SQLSTATE (D9, never message text), and return a fresh
 * get_today with the event. The screen shows streaks from that snapshot, not
 * from the event: a partial completion's habit_streak can be stale (D7, #70).
 */

export type TodayErrorCode =
  | "signed_out"
  | "not_found"
  | "not_today"
  | "done"
  | "too_late"
  | "no_balance"
  | "not_onboarded"
  | "failed";

/**
 * `event` is null when the write committed but its response couldn't be
 * read; `today` is null when the fresh snapshot couldn't be loaded.
 */
export type TodayResult<E> =
  | { ok: true; event: E | null; today: Today | null }
  | { ok: false; code: TodayErrorCode; error: string };

const fail = (code: TodayErrorCode, error: string) =>
  ({ ok: false, code, error }) as const;

const COMPLETE_ERRORS: Record<string, [TodayErrorCode, string]> = {
  QX101: ["not_today", "That habit isn't scheduled today."],
  QX102: ["not_found", "That habit is archived."],
  QX103: ["done", "Already done for today."],
  QX107: ["not_onboarded", "Finish setting up your account first."],
  QX109: ["failed", "Too fast. Wait a minute and try again."],
};

const UNDO_ERRORS: Record<string, [TodayErrorCode, string]> = {
  QX104: ["too_late", "The undo window has passed."],
  QX105: ["too_late", "Only today's completions can be undone."],
  QX106: [
    "no_balance",
    "You've already spent those points, so this can't be undone.",
  ],
  QX108: ["too_late", "A later day already counts on this one."],
  QX109: ["failed", "Too fast. Wait a minute and try again."],
};

function fromDb(
  error: { code?: string },
  table: Record<string, [TodayErrorCode, string]>,
  missing: string,
) {
  const code = error.code ?? "";
  if (code in table) return fail(...table[code]);
  if (code === "P0002") return fail("not_found", missing);
  if (code === "28000") return fail("signed_out", "You're signed out.");
  if (code === DEADLOCK) return fail("failed", RETRY_MESSAGE);
  return fail("failed", "Couldn't save. Try again.");
}

type Rpc = "complete_habit" | "undo_completion";

async function run<E>(
  fn: Rpc,
  args: { p_habit_id: string } | { p_completion_id: string },
  schema: { safeParse: (v: unknown) => { success: boolean; data?: E } },
  errors: Record<string, [TodayErrorCode, string]>,
  missing: string,
): Promise<TodayResult<E>> {
  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  // The generated types give each RPC its own args; both shapes are checked above.
  const { data, error } = await s.supabase.rpc(fn, args as never);
  if (error) return fromDb(error, errors, missing);

  const event = schema.safeParse(data);
  const loaded = await loadToday(s.supabase);
  const today = loaded.ok ? loaded.today : null;
  // The write committed even if its response is unreadable: report success,
  // so the screen keeps the completion instead of inviting a second tap.
  return { ok: true, event: event.success ? (event.data as E) : null, today };
}

export async function completeHabit(
  habitId: unknown,
): Promise<TodayResult<CompleteEvent>> {
  const id = habitIdSchema.safeParse(habitId);
  if (!id.success) return fail("not_found", "That habit doesn't exist.");
  return run(
    "complete_habit",
    { p_habit_id: id.data },
    completeEventSchema,
    COMPLETE_ERRORS,
    "That habit doesn't exist.",
  );
}

export async function undoCompletion(
  completionId: unknown,
): Promise<TodayResult<UndoEvent>> {
  const id = uuidSchema.safeParse(completionId);
  if (!id.success) return fail("not_found", "That completion doesn't exist.");
  return run(
    "undo_completion",
    { p_completion_id: id.data },
    undoEventSchema,
    UNDO_ERRORS,
    "That completion doesn't exist.",
  );
}
