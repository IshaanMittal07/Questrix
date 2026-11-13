# Economy

The source of truth for formulas is plan §6 ([BUILD_PLAN.md](BUILD_PLAN.md)). Tunable numbers live in the `economy_config` table (Phase 4).

| Rule              | Formula                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| Base points       | easy 10 · medium 20 · hard 35                                              |
| Multiplier        | `1 + 0.01 × min(streak_after_today, 50)`                                   |
| Points            | `floor(base × multiplier)`                                                 |
| Level             | `floor(sqrt(lifetime_points / 50)) + 1`                                    |
| Streak milestones | 3→25 · 7→75 · 14→150 · 30→400 · 60→800 · 100→1,500 · 180→3,000 · 365→5,000 |

_Filled in with implementation details in Phase 4._
