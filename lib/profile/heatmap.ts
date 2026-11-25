/** The 12-week activity heatmap: pure date math, so it's unit-testable. */

export const HEATMAP_WEEKS = 12;

export type HeatCell = { date: string; count: number; future: boolean };

/** YYYY-MM-DD for `now` in an IANA timezone. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Columns are weeks (Sunday first), oldest on the left; the last column holds
 * today, with the rest of that week marked future.
 */
export function buildHeatmap(
  today: string,
  counts: Map<string, number>,
  weeks = HEATMAP_WEEKS,
): HeatCell[][] {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = addDays(today, -dow - 7 * (weeks - 1));
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      col.push({ date, count: counts.get(date) ?? 0, future: date > today });
    }
    cols.push(col);
  }
  return cols;
}

/** 0 = none, 1 = 1–2, 2 = 3–4, 3 = 5+. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}
