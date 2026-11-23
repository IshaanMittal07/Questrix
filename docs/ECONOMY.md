# Economy

Plan §6 ([BUILD_PLAN.md](BUILD_PLAN.md)) is the source of truth for the formulas. The implementation and the reasoning behind each choice are in [DECISIONS.md](DECISIONS.md) § Phase 4. The server is authoritative: all of this runs in SECURITY DEFINER Postgres functions (`complete_habit`, `undo_completion`, `get_today`), and the client never computes or writes a balance.

## Formulas

| Rule              | Formula                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Base points       | easy 10 · medium 20 · hard 35 (`base_points`)                                             |
| Multiplier        | `round(1 + multiplier_step × min(max(streak_after_today, 1), multiplier_cap), 2)`         |
| Points            | `floor(base × multiplier)`; the stored multiplier reproduces the award (formula CHECK)    |
| Level             | `floor(sqrt(lifetime_points / 50)) + 1`, so level L starts at `50 × (L − 1)²` points      |
| Streak milestones | 3→25 · 7→75 · 14→150 · 30→400 · 60→800 · 100→1,500 · 180→3,000 · 365→5,000 (`milestones`) |

The level is computed in SQL (`level_for`) and in TS (`lib/points/levels.ts`, for the progress ring). Parity tests on both sides pin the same boundaries: `060_get_today.sql` and `levels.test.ts`.

## Config keys (`economy_config`)

Values are validated by `economy_config_value_valid`. Unknown keys are rejected. A missing key makes the engine raise, because that's a server bug.

| Key                             | Default                             | Allowed                                      | Used by                                                                                  |
| ------------------------------- | ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `base_points`                   | `{"easy":10,"medium":20,"hard":35}` | each a whole number, 1–1,000                 | points                                                                                   |
| `multiplier_step`               | `0.01`                              | 0–0.1                                        | multiplier                                                                               |
| `multiplier_cap`                | `50`                                | whole number, 0–89                           | multiplier                                                                               |
| `milestones`                    | see above                           | `{}` or keys 1–9999 → whole 1–100,000 points | milestone bonuses                                                                        |
| `undo_window_minutes`           | `15`                                | whole number, 1–1,440                        | `undo_completion`, `get_today`                                                           |
| `streak_lookback_days`          | `7`                                 | whole number, 1–31                           | streaks: a longer gap always breaks                                                      |
| `streak_freezes_max`            | `2`                                 | whole number, 0–2                            | the cap when undo gives freezes back; Phase 6 `purchase_item` caps purchases with it too |
| `schedule_max_habits`           | `20`                                | whole number, 1–50                           | habits in one day's snapshot                                                             |
| `habit_create_limits`           | `{"per_day":30,"per_30_days":100}`  | whole numbers, 1–1,000 / 1–10,000            | the habits trigger                                                                       |
| `timezone_change_cooldown_days` | `7`                                 | whole number, 0–365                          | timezone changes after onboarding (#28)                                                  |

Two keys are also bounded by CHECK constraints, so raise the constraint before raising the key:

- `streak_freezes_max`: `profiles.streak_freezes` must be 0–2, and so must `daily_progress.streak_freezes_used`.
- The multiplier: `habit_completions.multiplier` is `numeric(4,2)` and at most 9.99. The ranges above keep `1 + step × cap` at 9.9 or below.

## Streaks

- **One counted day.** A day counts on its first completion. The rules (plan §6.2) run then, and the day's before-state is saved for undo.
- **Days.** A day is the user's local date in `profiles.timezone` (Postgres tzdata). Which habits a day requires is fixed by its snapshot (`daily_schedule`), taken on the day's first engine call or before any edit. Edits only affect days that haven't been snapshotted yet.
- **Rest days.** A day whose snapshot requires nothing doesn't break the streak.
- **Late joiners.** A habit that joins a day after its first snapshot (added, unarchived or rescheduled) earns points, at the multiplier for the streak as it stands, but doesn't count the day (#82).
- **Missed days.** A scheduled day with no completion is missed, and so is a day with no snapshot (fail closed). Freezes cover missed days one each, spent by the next counted day. If there are more missed days than freezes, or a gap longer than `streak_lookback_days`, the streak resets to 1 and no freezes are spent.
- **Per-habit streaks** advance when a day's count first reaches the habit's snapshotted target. They have no freezes.
- **Timezones.** Moving east keeps the streak without gaining a day (#28). Moving west relives earlier days. A relived day that was already counted changes nothing. One that wasn't (a missed day) earns points at the base multiplier but never counts, so it stays missed (#81). Changes after onboarding are limited by `timezone_change_cooldown_days`.
- **`get_today`** reports the streak as the next completion would see it. A streak that would reset reads 0, though the stored value only changes on that completion. `freezes_needed` says how many freezes the next completion will spend.
- **At risk** (`get_today.at_risk`): the day requires habits, there's a live streak, today isn't counted yet, and it's 18:00 or later local time.

## Undo

- **When it's allowed.** Only your own completion from today, within `undo_window_minutes`, and only if the balance covers the points plus any milestone the undo revokes. That stops complete → spend → undo.
- **Points.** It reverses the award with a negative `undo` ledger entry. `lifetime_points` drops by the same amount.
- **Emptying the day** restores the streak state saved when the day counted and revokes that day's milestones. Freezes come back as a delta (`streak_freezes_used`), so a freeze gained since survives.
- **Dropping a habit below its target** restores that habit's streak.
- **QX108.** After a move west, an undo that a later day was built on is refused.

## Invariants (pgTAP `070_engine_invariants`, after every step of a randomized sequence)

- `points_balance = sum(points_ledger.delta)`, and `lifetime_points = sum(delta)` over `completion`, `streak_milestone` and `undo` entries.
- Every completion has its ledger entry. Every removed completion or milestone is reversed exactly once.
- `daily_progress.completed_count` matches the completions, and no empty day is counted.
- Every award follows the formula, and occurrences stay within the snapshotted target.
- Every streak ends on a day with a completion, except after eastward inheritance (#28). Every habit streak ends on a day that reached its target.
- Every milestone has its ledger entry and a completed day.
