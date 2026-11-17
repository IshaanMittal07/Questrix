/**
 * Habit limits, colour tokens and the JS mirror of habits_clean_text, with no
 * zod or generated-type imports, so client components can use them without
 * pulling the validation schemas into the bundle. lib/validation/habit.ts
 * re-exports everything here.
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

/** JS mirror of habits_clean_text: strip invisibles, trim; blank becomes "". */
export function cleanHabitText(value: string) {
  return value.replace(STRIP_RE, "").replace(TRIM_RE, "");
}
