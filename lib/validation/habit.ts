import { z } from "zod";

import { Constants } from "@/lib/supabase/types";

/**
 * Zod schemas for habit input. They mirror the habits table's CHECKs and the
 * habits_before_write trigger so forms can show errors early; the database
 * stays authoritative. Deliberately absent: user_id, sort_order (server-owned,
 * reorder via reorder_habits), archived_at (archive/unarchive RPCs) and
 * created_at. Objects are strict, so those keys are rejected, not dropped.
 */

export const HABIT_LIMITS = {
  titleMax: 60,
  descriptionMax: 280,
  iconMax: 32,
  targetMax: 5,
  remindersMax: 5,
  activeMax: 20,
} as const;

export const HABIT_COLORS = [
  "cyan",
  "violet",
  "magenta",
  "success",
  "warning",
] as const;

// Code points habits_clean_text strips anywhere, built from numbers so this
// source stays ASCII (invisible characters can't be reviewed). Keep in sync
// with the migration: soft hyphen, Arabic letter mark, Mongolian vowel
// separator, ZWSP, LRM/RLM, bidi embeddings/overrides, U+2060-206F (incl.
// isolates), Hangul filler, BOM.
const STRIP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [173, 173],
  [1564, 1564],
  [6158, 6158],
  [8203, 8203],
  [8206, 8207],
  [8234, 8238],
  [8288, 8303],
  [12644, 12644],
  [65279, 65279],
];
// Only trimmed at the ends: ZWNJ/ZWJ join emoji and Persian/Indic text, and
// NEL (U+0085) is matched by Postgres \s but not by JS \s.
const EDGE_ONLY = [133, 8204, 8205];

const cp = (n: number) => `\\u{${n.toString(16)}}`;
const STRIP_RE = new RegExp(
  `[${STRIP_RANGES.map(([a, b]) => (a === b ? cp(a) : `${cp(a)}-${cp(b)}`)).join("")}]`,
  "gu",
);
const EDGE_CLASS = `[\\s${EDGE_ONLY.map(cp).join("")}]+`;
const TRIM_RE = new RegExp(`^${EDGE_CLASS}|${EDGE_CLASS}$`, "gu");
const CONTROL_RE = /\p{Cc}/u;

/** JS mirror of habits_clean_text: strip invisibles, trim; blank becomes "". */
export function cleanHabitText(value: string) {
  return value.replace(STRIP_RE, "").replace(TRIM_RE, "");
}

/** Postgres char_length counts code points, not UTF-16 units. */
const codePoints = (s: string) => [...s].length;

const cleaned = z.string().transform(cleanHabitText);

export const habitTitleSchema = cleaned.pipe(
  z
    .string()
    .min(1, "Give your habit a name")
    .refine(
      (s) => codePoints(s) <= HABIT_LIMITS.titleMax,
      `At most ${HABIT_LIMITS.titleMax} characters`,
    )
    .refine((s) => !CONTROL_RE.test(s), "Remove control characters"),
);

/** Optional text that the database stores as null when blank. */
function optionalText(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => {
      if (s === undefined) return undefined;
      const out = s === null ? "" : cleanHabitText(s);
      return out === "" ? null : out;
    })
    .refine(
      (s) => s == null || codePoints(s) <= max,
      `At most ${max} characters`,
    );
}

// Raw input bound: the trigger rejects oversized arrays before de-duplicating,
// so this only caps the work done here; the real limits apply after de-dup.
const RAW_ARRAY_MAX = 50;

export const habitDaysSchema = z
  .array(
    z
      .int("Pick a day of the week")
      .min(0, "Pick a day of the week")
      .max(6, "Pick a day of the week"),
  )
  .max(RAW_ARRAY_MAX, "Too many days")
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))
  .pipe(z.array(z.int()).min(1, "Pick at least one day"));

/**
 * Local wall-clock time, 00:00-23:59 (24:00 is rejected, as in SQL), output
 * as "HH:MM". Seconds are accepted and dropped, as the trigger truncates to
 * the minute: PostgREST returns time values as "07:30:00", and some browsers'
 * time inputs include seconds.
 */
export const reminderTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?$/,
    "Use a time like 07:30",
  )
  .transform((t) => t.slice(0, 5));

export const reminderTimesSchema = z
  .array(reminderTimeSchema)
  .max(RAW_ARRAY_MAX, "Too many reminders")
  .transform((times) => [...new Set(times)].sort())
  .pipe(
    z
      .array(z.string())
      .max(
        HABIT_LIMITS.remindersMax,
        `At most ${HABIT_LIMITS.remindersMax} reminders`,
      ),
  );

const editableFields = {
  title: habitTitleSchema,
  description: optionalText(HABIT_LIMITS.descriptionMax),
  category: z.enum(Constants.public.Enums.habit_category),
  difficulty: z.enum(Constants.public.Enums.habit_difficulty),
  icon: optionalText(HABIT_LIMITS.iconMax),
  color: z.enum(HABIT_COLORS).nullable(),
  days_of_week: habitDaysSchema,
  target_per_day: z
    .int("Choose how many times a day")
    .min(1, "At least once a day")
    .max(
      HABIT_LIMITS.targetMax,
      `At most ${HABIT_LIMITS.targetMax} times a day`,
    ),
  reminder_times: reminderTimesSchema,
  reminders_enabled: z.boolean(),
};

/**
 * Every editable field, required and strict: the base for per-field checks in
 * actions and shared form fields. The schemas take typed values (numbers,
 * booleans, arrays), not FormData strings; actions receive plain objects
 * (DECISIONS § Phase 3). Never add z.coerce.boolean(): it turns "false" into
 * true.
 */
export const habitFieldsSchema = z.strictObject(editableFields);

/**
 * Insert payload. Send the parsed output, never the raw input: the trigger
 * checks array sizes before de-duplicating. Never use it with upsert: that
 * needs UPDATE on every column.
 */
export const habitCreateSchema = z.strictObject({
  ...editableFields,
  difficulty: editableFields.difficulty.default("medium"),
  color: editableFields.color.optional(),
  days_of_week: editableFields.days_of_week.default([0, 1, 2, 3, 4, 5, 6]),
  target_per_day: editableFields.target_per_day.default(1),
  reminder_times: editableFields.reminder_times.default([]),
  reminders_enabled: editableFields.reminders_enabled.default(true),
  // Untrusted analytics only (DECISIONS § Phase 3).
  template_key: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
});

/**
 * Update payload: any subset of the editable fields, at least one. Keys given
 * as undefined are dropped (JSON would drop them anyway), so they don't count.
 * Stricter than the column grant on purpose: template_key records where a
 * habit came from, so edits can't change it.
 */
export const habitUpdateSchema = habitFieldsSchema
  .partial()
  .transform(
    (v) =>
      Object.fromEntries(
        Object.entries(v).filter(([, x]) => x !== undefined),
      ) as typeof v,
  )
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/**
 * Lowercased so case variants of one id compare equal, as Postgres uuid does.
 * z.uuid() checks RFC version bits: fine for gen_random_uuid() (v4), but test
 * fixtures must use real v4 ids.
 */
export const habitIdSchema = z.uuid().transform((s) => s.toLowerCase());

/** Full active-list order for reorder_habits: unique ids, 1..20. */
export const habitOrderSchema = z
  .array(habitIdSchema)
  .min(1, "No habits to reorder")
  .max(HABIT_LIMITS.activeMax, `At most ${HABIT_LIMITS.activeMax} habits`)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate habit");

export type HabitCreateInput = z.input<typeof habitCreateSchema>;
export type HabitCreate = z.output<typeof habitCreateSchema>;
export type HabitUpdate = z.output<typeof habitUpdateSchema>;
