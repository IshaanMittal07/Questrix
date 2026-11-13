# Questrix

> _Level up your real life._

A gamified, mobile-first habit tracker (installable PWA): daily habits, reminders, points, streaks, a customizable avatar and a social feed.

**Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Supabase (Postgres, Auth, RLS), Vitest, pgTAP and Playwright, deployed on Vercel.

## Setup

Prerequisites: Node 22+ (see `.nvmrc`), [pnpm](https://pnpm.io), and Docker Desktop (for the local Supabase stack).

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm db:start                # local Supabase (needs Docker)
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command                                  | What it does                                   |
| ---------------------------------------- | ---------------------------------------------- |
| `pnpm dev`                               | Start the dev server                           |
| `pnpm lint`                              | ESLint (`eslint .`)                            |
| `pnpm typecheck`                         | Generate Next route types, then `tsc --noEmit` |
| `pnpm test`                              | Unit tests (Vitest)                            |
| `pnpm format` / `pnpm format:check`      | Prettier                                       |
| `pnpm build`                             | Production build                               |
| `pnpm db:start` / `db:reset` / `db:test` | Supabase local stack, reset, pgTAP tests       |
| `pnpm db:types`                          | Regenerate `lib/supabase/types.ts`             |

## Docs

- [Build plan](docs/BUILD_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Economy](docs/ECONOMY.md)
- [Runbook](docs/RUNBOOK.md)

## Contributing

Work goes phase by phase through issues, branches and PRs into a protected `main`. See [CLAUDE.md](CLAUDE.md).
