"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getTemplate, templateToHabit } from "@/lib/habits/templates";
import { DEADLOCK, RETRY_MESSAGE, serverMessage } from "@/lib/supabase/errors";
import { getVerifiedUser } from "@/lib/supabase/session";
import {
  habitCreateSchema,
  habitIdSchema,
  habitOrderSchema,
  habitUpdateSchema,
} from "@/lib/validation/habit";

/**
 * Server Actions for habits. Each one takes plain typed values (not
 * FormData), validates them with the habit schemas, re-checks the session
 * with getClaims, and writes the *parsed* output (DECISIONS § Phase 3). The
 * database (RLS, column grants, the habits trigger and RPCs) stays
 * authoritative; these only give early, friendly errors.
 */

export type HabitErrorCode =
  | "invalid"
  | "signed_out"
  | "not_found"
  | "at_cap"
  | "rate_limited"
  | "stale"
  | "failed";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: HabitErrorCode; error: string; field?: string };

const STARTER_MAX = 3;

type PgError = { code?: string; message?: string; hint?: string | null };

const fail = (
  code: HabitErrorCode,
  error: string,
  field?: string,
): { ok: false; code: HabitErrorCode; error: string; field?: string } =>
  field === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, field };

function invalid(e: z.ZodError) {
  const issue = e.issues[0];
  // Only name a habit field: list inputs have numeric paths.
  const key = issue?.path[0];
  const field = typeof key === "string" ? key : undefined;
  return fail("invalid", issue?.message ?? "Check the habit's details.", field);
}

/** Maps a PostgREST error to a user-facing result. Never leaks raw SQL text. */
function fromDb(error: PgError) {
  switch (error.code) {
    case "QX001":
      // Rate limit from the habits trigger; its message and hint are ours.
      return fail(
        "rate_limited",
        serverMessage(error.message ?? "Too many new habits", error.hint),
      );
    case DEADLOCK:
      return fail("failed", RETRY_MESSAGE);
    case "23514":
      // Must match the cap message in the habits trigger (migration
      // 20261116000100_habits.sql); pgTAP 020_habits_rls.sql pins that text.
      return /active habits/.test(error.message ?? "")
        ? fail(
            "at_cap",
            "You can have at most 20 active habits. Archive one first.",
          )
        : fail("invalid", "Check the habit's details.");
    case "P0002":
      return fail("not_found", "That habit doesn't exist.");
    case "28000":
      return fail("signed_out", "You're signed out.");
    case "22023":
      return fail("stale", "Your list changed. Refresh and try again.");
    default:
      return fail("failed", "Couldn't save. Try again.");
  }
}

function revalidateHabits() {
  revalidatePath("/habits");
  revalidatePath("/today");
}

export async function createHabit(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = habitCreateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  // Untrusted, but kept clean: only library keys, so Phase 7 counts are real.
  const key = parsed.data.template_key;
  if (key !== undefined && !getTemplate(key))
    return fail("invalid", "Unknown habit template", "template_key");

  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  const { data, error } = await s.supabase
    .from("habits")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error) return fromDb(error);

  revalidateHabits();
  return { ok: true, data: { id: data.id } };
}

export async function updateHabit(
  id: unknown,
  patch: unknown,
): Promise<ActionResult> {
  const habitId = habitIdSchema.safeParse(id);
  if (!habitId.success) return fail("not_found", "That habit doesn't exist.");
  const parsed = habitUpdateSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);

  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  const { data, error } = await s.supabase
    .from("habits")
    .update(parsed.data)
    .eq("id", habitId.data)
    .eq("user_id", s.userId)
    .select("id")
    .maybeSingle();
  if (error) return fromDb(error);
  // RLS hides other users' habits, so no row means not found.
  if (!data) return fail("not_found", "That habit doesn't exist.");

  revalidateHabits();
  return { ok: true, data: undefined };
}

async function callHabitRpc(
  fn: "archive_habit" | "unarchive_habit",
  id: unknown,
): Promise<ActionResult> {
  const habitId = habitIdSchema.safeParse(id);
  if (!habitId.success) return fail("not_found", "That habit doesn't exist.");

  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  const { error } = await s.supabase.rpc(fn, { p_habit_id: habitId.data });
  if (error) return fromDb(error);

  revalidateHabits();
  return { ok: true, data: undefined };
}

export async function archiveHabit(id: unknown) {
  return callHabitRpc("archive_habit", id);
}

export async function unarchiveHabit(id: unknown) {
  return callHabitRpc("unarchive_habit", id);
}

/** The full active list in its new order (reorder_habits needs every id). */
export async function reorderHabits(ids: unknown): Promise<ActionResult> {
  const parsed = habitOrderSchema.safeParse(ids);
  if (!parsed.success) return invalid(parsed.error);

  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  const { error } = await s.supabase.rpc("reorder_habits", {
    p_habit_ids: parsed.data,
  });
  if (error) return fromDb(error);

  revalidateHabits();
  return { ok: true, data: undefined };
}

const starterKeysSchema = z
  .array(z.string())
  .max(STARTER_MAX, `Pick at most ${STARTER_MAX} habits`)
  .refine((keys) => new Set(keys).size === keys.length, "Duplicate habit")
  .refine(
    (keys) => keys.every((k) => getTemplate(k) !== undefined),
    "Unknown habit template",
  );

/**
 * Onboarding step 2: add up to 3 starter habits. The client sends template
 * keys only; every field is built here from the library, so nothing else
 * the client sends can reach the insert. An empty list (Skip) is a no-op.
 * One multi-row insert, so the cap and rate limits apply to all or none.
 */
export async function addStarterHabits(
  keys: unknown,
): Promise<ActionResult<{ count: number }>> {
  const parsed = starterKeysSchema.safeParse(keys);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.length === 0) return { ok: true, data: { count: 0 } };

  const rows = parsed.data.map((k) =>
    habitCreateSchema.parse(templateToHabit(getTemplate(k)!)),
  );

  const s = await getVerifiedUser();
  if (!s) return fail("signed_out", "You're signed out.");

  const { error } = await s.supabase.from("habits").insert(rows);
  if (error) return fromDb(error);

  revalidateHabits();
  return { ok: true, data: { count: rows.length } };
}
