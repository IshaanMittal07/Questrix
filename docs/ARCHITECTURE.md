# Architecture

Questrix is a Next.js (App Router) PWA backed by Supabase (Postgres, Auth, RLS, Realtime, Storage) and deployed on Vercel.

## Principles

- **Stateless app servers.** All state lives in Postgres.
- **Server-authoritative economy.** Points, streaks and purchases are computed only inside SECURITY DEFINER Postgres functions. The client never writes a balance.
- **RLS on every table**, plus column-level grants for user-editable rows.
- **Keyset pagination** (`created_at, id`), max page size 50.
- **Scheduled work** runs in Supabase `pg_cron` (with `pg_net` for HTTP calls to the app).

## Layout

See plan §4 ([BUILD_PLAN.md](BUILD_PLAN.md)). This document grows as phases land.
