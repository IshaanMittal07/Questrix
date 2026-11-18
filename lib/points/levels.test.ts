import { describe, expect, it } from "vitest";
import { levelFor, levelProgress, pointsForLevel } from "./levels";

// Parity with SQL public.level_for (supabase/tests/060_get_today.sql pins
// the same boundaries and fixture values). The server's level is
// authoritative; the UI uses these for the ring, so they must agree.
describe("level parity with level_for", () => {
  it("starts level L at exactly 50·(L-1)² for L up to 300", () => {
    for (let level = 1; level <= 300; level++) {
      const start = 50 * (level - 1) ** 2;
      expect(levelFor(start)).toBe(level);
      if (level > 1) expect(levelFor(start - 1)).toBe(level - 1);
      expect(pointsForLevel(level)).toBe(start);
    }
  });

  it.each([
    [0, 1],
    [49, 1],
    [50, 2],
    [199, 2],
    [200, 3],
    [-5, 1],
    [4_500_000, 301],
  ])("levelFor(%i) = %i, as in SQL", (points, level) => {
    expect(levelFor(points)).toBe(level);
  });
});

describe("levelProgress", () => {
  it("reports progress within the level", () => {
    expect(levelProgress(260)).toEqual({ level: 3, current: 60, needed: 250 });
  });

  it("counts negative input as 0", () => {
    expect(levelProgress(-10)).toEqual({ level: 1, current: 0, needed: 50 });
  });
});
