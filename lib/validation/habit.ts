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
// ZWNJ/ZWJ join emoji and Persian/Indic text, so they are only trimmed at the ends.
const EDGE_ONLY = [8204, 8205];

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

export const habitDaysSchema = z
  .array(z.int().min(0).max(6))
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))
  .pipe(z.array(z.int()).min(1, "Pick at least one day").max(7));

/** "HH:MM" local wall-clock time, 00:00-23:59 (24:00 is rejected, as in SQL). */
export const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 07:30");

export const reminderTimesSchema = z
  .array(reminderTimeSchema)
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
  target_per_day: z.int().min(1).max(HABIT_LIMITS.targetMax),
  reminder_times: reminderTimesSchema,
  reminders_enabled: z.boolean(),
};

/** Insert payload. Never use it with upsert: that needs UPDATE on every column. */
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

/** Update payload: any subset of the editable fields, at least one. */
export const habitUpdateSchema = z
  .strictObject(editableFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const habitIdSchema = z.uuid();

/** Full active-list order for reorder_habits: unique ids, 1..20. */
export const habitOrderSchema = z
  .array(habitIdSchema)
  .min(1)
  .max(HABIT_LIMITS.activeMax)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate habit");

export type HabitCreateInput = z.input<typeof habitCreateSchema>;
export type HabitCreate = z.output<typeof habitCreateSchema>;
export type HabitUpdate = z.output<typeof habitUpdateSchema>;
