/**
 * Display-only level math (plan §6.3). The server is authoritative for points;
 * this only turns lifetime points into a level + progress for the UI.
 */
export function levelFor(lifetimePoints: number) {
  return Math.floor(Math.sqrt(Math.max(0, lifetimePoints) / 50)) + 1;
}

/** Lifetime points needed to reach `level`. */
export function pointsForLevel(level: number) {
  return 50 * (level - 1) ** 2;
}

/** Progress within the current level. Negative input (for example after an undo) counts as 0. */
export function levelProgress(lifetimePoints: number) {
  const points = Math.max(0, lifetimePoints);
  const level = levelFor(points);
  const floor = pointsForLevel(level);
  const next = pointsForLevel(level + 1);
  return { level, current: points - floor, needed: next - floor };
}
