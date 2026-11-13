# Questrix

Questrix ("Level up your real life.") is a gamified, mobile-first habit tracker built as an installable PWA. Users track daily habits, get push reminders, and earn points and streaks. Points buy avatar cosmetics, and users can share progress in a social feed.

The stack is Next.js 16 (App Router, TS strict), Tailwind 4, Supabase (Postgres, Auth, RLS, pg_cron), Vitest, pgTAP and Playwright, deployed on Vercel.

The single source of truth is [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md), a copy of `QUESTRIX_BUILD_PLAN.md`. Keep it updated as decisions change, and record deviations in [docs/DECISIONS.md](docs/DECISIONS.md).

@AGENTS.md

## Commands

```bash
pnpm dev                 # dev server
pnpm lint                # eslint .
pnpm typecheck           # next typegen && tsc --noEmit
pnpm test                # vitest run (tests/unit)
pnpm test:e2e            # Playwright (from Phase 3)
pnpm format:check        # prettier
pnpm build
pnpm exec supabase start           # local Supabase (Docker required)
pnpm exec supabase db reset        # re-apply migrations + seed
pnpm exec supabase test db         # pgTAP tests in supabase/tests
pnpm exec supabase gen types typescript --local > lib/supabase/types.ts
```

## Non-negotiable rules

- **The server is authoritative for points, streaks and purchases.** The client never computes or writes a balance. All of that logic lives in SECURITY DEFINER Postgres functions that `set search_path = ''`, schema-qualify names and derive the user from `auth.uid()`.
- Every table has RLS and pgTAP tests for its policies.
- Never commit secrets. Secrets go in `.env.local` and the host's env settings, and `.env.example` holds names only. The service-role key is used only in `import 'server-only'` files.
- Install the latest stable versions with `pnpm add`. Never invent versions. If the plan conflicts with current docs, follow the docs and record the deviation.

## GitHub workflow (plan §11)

For each phase:

1. Create a tracking issue (label `phase-N`, with its milestone).
2. Run the `planner` subagent and post its plan as an issue comment.
3. Create one issue per task.
4. Branch `phase-N/<slug>`.
5. Make Conventional Commits that reference issues (`refs #12`).
6. Run the `test-writer` subagent. Lint, typecheck, unit, db and build must all be green locally.
7. Open a draft PR from the template with `Closes #…` for every issue.
8. Run the `code-reviewer` subagent (plus `security-auditor` in Phases 2, 4, 6, 7 and 8) and post the review with `gh pr review --comment`.
9. Fix every Blocking and Should-fix item, then re-review.
10. Run `gh pr ready`, then wait for CI to go green.
11. **Ask the human before merging.** Then squash-merge.
12. Tag `v0.N.0` and create a release.

`main` is protected: it requires a PR, the `ci` and `db-tests` checks (plus `e2e` from Phase 3) and linear history.
