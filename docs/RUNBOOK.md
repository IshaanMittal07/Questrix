# Runbook

## Local development

1. Install Node 22+ and pnpm, then run `pnpm install`.
2. Start Docker Desktop, then run `pnpm db:start` (Supabase local stack).
3. Copy `.env.example` to `.env.local` and fill it in with the values `supabase start` prints.
4. Run `pnpm dev`.

## Production setup

_Written in Phases 5 and 8: Vercel env vars, Supabase Vault secrets (`app_url`, `cron_secret`), pg_cron jobs, VAPID keys and Auth redirect URLs._
