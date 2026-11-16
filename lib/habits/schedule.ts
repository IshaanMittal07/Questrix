/**
 * Habit schedules in the user's timezone, for display only (Today ordering,
 * "not today" labels). SQL is authoritative for whether a habit is due:
 * browser ICU and Postgres tzdata can disagree (DECISIONS § Phase 3).
 *
 * Weekdays are 0 = Sunday … 6 = Saturday, matching JS getDay() and Postgres
 * extract(dow), which is how habits.days_of_week stores them.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_DAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type LocalDate = {
  /** YYYY-MM-DD in the given timezone. */
  key: string;
  weekday: Weekday;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      // Pin the calendar so a user's locale extension can't change it.
      calendar: "gregory",
      numberingSystem: "latn",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The calendar date and weekday of `instant` in `timeZone`. An unknown
 * timezone falls back to UTC rather than throwing, because this only drives
 * labels. An invalid Date still throws a RangeError (a caller bug).
 */
export function localDate(instant: Date, timeZone: string): LocalDate {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(instant);
  } catch {
    parts = formatterFor("UTC").formatToParts(instant);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")];
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday "${get("weekday")}"`);
  }
  return { key: `${get("year")}-${get("month")}-${get("day")}`, weekday };
}

export function isScheduledOn(daysOfWeek: readonly number[], weekday: Weekday) {
  return daysOfWeek.includes(weekday);
}

/** Whether a habit falls on the user's local "today" at `now`. */
export function isScheduledToday(
  daysOfWeek: readonly number[],
  timeZone: string,
  now: Date = new Date(),
) {
  return isScheduledOn(daysOfWeek, localDate(now, timeZone).weekday);
}

/**
 * Days from `weekday` until the habit is next scheduled: 0 if it is scheduled
 * that day, wrapping past Saturday into the next week. Null if the schedule
 * has no valid days.
 */
export function daysUntilNext(
  daysOfWeek: readonly number[],
  weekday: Weekday,
): number | null {
  for (let offset = 0; offset < 7; offset++) {
    if (daysOfWeek.includes((weekday + offset) % 7)) return offset;
  }
  return null;
}

/** "Every day", "Weekdays", "Weekends" or e.g. "Mon, Wed, Fri" (Monday first). */
export function describeDays(daysOfWeek: readonly number[]) {
  const set = new Set(daysOfWeek.filter((d) => d >= 0 && d <= 6));
  if (set.size === 7) return "Every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) {
    return "Weekdays";
  }
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => set.has(d))
    .map((d) => SHORT_NAMES[d])
    .join(", ");
}
