import { describe, expect, it } from "vitest";
import { levelFor, levelProgress, pointsForLevel } from "@/lib/points/levels";

describe("levels (plan §6.3)", () => {
  it.each([
    [0, 1],
    [49, 1],
    [50, 2],
    [800, 5],
    [4050, 10],
    [18050, 20],
  ])("%i lifetime points → level %i", (pts, level) => {
    expect(levelFor(pts)).toBe(level);
  });

  it("thresholds are inverse of levelFor", () => {
    for (let l = 1; l < 30; l++) expect(levelFor(pointsForLevel(l))).toBe(l);
  });

  it("reports progress within the current level", () => {
    expect(levelProgress(100)).toEqual({ level: 2, current: 50, needed: 150 });
  });
});
