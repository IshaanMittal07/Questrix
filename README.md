# Questrix

> _Level up your real life._

A gamified, mobile-first habit tracker (installable PWA): daily habits, reminders, points, streaks, a customizable avatar and a social feed.

**Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Supabase (Postgres, Auth, RLS), Vitest, pgTAP and Playwright, deployed on Vercel.

## Install on iPhone

Questrix is a web app you add to your Home Screen. Push reminders need iOS 16.4 or later and work only from the Home Screen app.

1. Open the Questrix link in **Safari**. Other iPhone browsers can't add web apps that receive notifications.
2. Tap the **Share** button (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open Questrix from the new Home Screen icon and sign in again. The Home Screen app keeps its own sign-in, separate from Safari.
4. Go to **Settings → Notifications** and tap **Enable notifications**, then allow them when iOS asks.

On Android or desktop Chrome and Edge, use the install icon in the address bar, or **Install app** in the browser menu.

## Setup

Prerequisites: Node 22.22.2+ on the 22 line (`engines` in `package.json`), [pnpm](https://pnpm.io), and Docker Desktop (for the local Supabase stack).

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
