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

export function levelProgress(lifetimePoints: number) {
  const level = levelFor(lifetimePoints);
  const floor = pointsForLevel(level);
  const next = pointsForLevel(level + 1);
  return { level, current: lifetimePoints - floor, needed: next - floor };
}
