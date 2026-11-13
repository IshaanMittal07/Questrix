# QUESTRIX — Master Build Plan for Claude Code

> **Tagline:** *Level up your real life.*
> A gamified, mobile-first productivity web app (installable PWA) for tracking daily habits, getting reminders, earning points and streaks, customizing an avatar, and sharing progress with friends.

---

## 0. How to use this file (read first, Claude Code)

You are Claude Code. This file is the single source of truth for building Questrix. Follow these rules for the whole project:

1. **Work phase by phase** (Section 12). Never start a phase until the previous phase's PR is merged.
2. **Every phase follows the GitHub workflow in Section 11**: milestone → issues → branch → commits → PR → review by the `code-reviewer` subagent → CI green → **stop and ask the human to approve the merge**.
3. **Before writing code in a phase**, invoke the `planner` subagent to produce a short task list for that phase, and post it as a comment on the phase's tracking issue.
4. **After writing code**, invoke the `test-writer` subagent for missing tests and the `code-reviewer` subagent for a review. Fix every "Blocking" finding before asking for a merge.
5. **Never invent versions.** Install the latest stable versions with the package manager (`pnpm add <pkg>`), and read each library's current docs if an API looks different from what this plan describes. If this plan conflicts with a library's current official docs, follow the docs and note the deviation in the PR description.
6. **Never commit secrets.** All secrets go in `.env.local` (git-ignored) and in the hosting provider's environment settings. Keep `.env.example` up to date with names only.
7. **Server is authoritative for points, streaks and purchases.** The client never computes or writes a balance. All of that happens inside Postgres functions (Section 6).
8. If something is ambiguous, prefer the simpler option, write it down in `docs/DECISIONS.md`, and continue. Only stop to ask the human for: merging, secrets/credentials, paid services, or anything destructive.

**Kick-off command for the human:** put this file in an empty folder, open Claude Code there, and say:
`Read QUESTRIX_BUILD_PLAN.md and execute Phase 0.`

---

## 1. Product summary

| Area | What it does |
|---|---|
| Habits | Create daily habits (title, category, difficulty, days of week, times per day, reminder times). Templates + smart suggestions when adding a new one. |
| Reminders | Web Push notifications at the user's chosen local times (works on iPhone once installed to the Home Screen, iOS 16.4+). |
| Points | Each completion earns points based on difficulty × streak multiplier. Milestone bonuses for streaks. |
| Streaks | Global daily streak + per-habit streaks. Rest days (no habits scheduled) don't break a streak. Streak Freezes can be bought. |
| Avatar & profile | Layered SVG avatar. Points buy outfits, name colours, name styles, titles, backgrounds, borders. Rarity tiers. |
| Social | Follow users, public forum feed, post results (with an auto-generated stats card), likes, comments, reports, weekly leaderboard. |
| Branding | Name **Questrix**, hex-pulse icon, futuristic launch animation. |

---

## 2. Brand: name, icon, launch animation

### 2.1 Name
**Questrix** = *quest* + *matrix*. Wordmark is set in uppercase with wide letter-spacing: `QUESTRIX`.
(Before a public launch, the human should do a quick trademark/domain check. This doesn't block development.)

### 2.2 Colour tokens (dark-first, neon sci-fi)
```
--bg:            #070A12   /* near-black navy */
--surface:       #0E1424
--surface-2:     #151D33
--text:          #E8EEFF
--text-muted:    #8A96B8
--neon-cyan:     #22E5FF
--neon-violet:   #8B5CFF
--neon-magenta:  #FF3DCB
--success:       #3DFFA8
--warning:       #FFC83D
--danger:        #FF4D6D
--gradient-brand: linear-gradient(135deg, #22E5FF 0%, #8B5CFF 50%, #FF3DCB 100%)
```
Fonts (Google Fonts via `next/font`): **Orbitron** for the wordmark and headings, **Inter** for body text.
All text and background pairs used for body copy must pass WCAG AA contrast (4.5:1).

### 2.3 App icon (create exactly this as `public/brand/icon.svg`)
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="qx-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22E5FF"/>
      <stop offset="0.5" stop-color="#8B5CFF"/>
      <stop offset="1" stop-color="#FF3DCB"/>
    </linearGradient>
    <filter id="qx-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="#070A12"/>
  <polygon id="qx-hex" points="256,56 429.2,156 429.2,356 256,456 82.8,356 82.8,156"
           fill="none" stroke="url(#qx-grad)" stroke-width="22" stroke-linejoin="round" filter="url(#qx-glow)"/>
  <path id="qx-pulse" d="M132 300 H190 L218 246 L252 332 L298 176 L328 248 H380"
        fill="none" stroke="url(#qx-grad)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" filter="url(#qx-glow)"/>
  <circle id="qx-spark" cx="298" cy="176" r="14" fill="#FFFFFF" filter="url(#qx-glow)"/>
</svg>
```
Meaning: a hexagon "shield" (a game badge) containing a heartbeat pulse that spikes upward (progress), with a spark at the peak (the reward).

**Icon files to generate** (write `scripts/generate-icons.ts` using `sharp` to rasterize the SVG; iOS doesn't use SVG for home-screen icons):
- `public/icons/icon-192.png`, `public/icons/icon-512.png`
- `public/icons/icon-maskable-512.png` (same artwork scaled to 80% on a full-bleed `#070A12` background so it survives Android masking)
- `public/icons/apple-touch-icon.png` (180×180, **no transparency**, linked via `<link rel="apple-touch-icon">` / Next.js metadata)
- `app/favicon.ico` (32×32) — sharp can't write ICO, so render a 32×32 PNG with sharp and convert it with `png-to-ico`, **replacing** the scaffolded `app/favicon.ico` (don't also add `public/favicon.ico`, or Next.js reports a conflicting public/page file) — and `app/icon.svg`
- The icon's rounded `rx="112"` background leaves transparent corners, so rasterize `apple-touch-icon.png` and `icon-maskable-512.png` with `sharp(...).flatten({ background: '#070A12' })`.

### 2.4 Launch animation (`components/brand/LaunchSplash.tsx`)
Plays when the app opens (once per browser session, tracked with `sessionStorage`). Total ≈ 2.4 s. Tapping anywhere skips it.

| Time | Effect |
|---|---|
| 0.00–0.20 s | Black screen with faint moving scanlines (CSS repeating-linear-gradient, animated `background-position`) and a subtle grid floor in perspective. |
| 0.20–0.90 s | Hexagon outline **draws itself** (SVG `stroke-dasharray`/`stroke-dashoffset` animation). |
| 0.70–1.30 s | Pulse line draws left → right; spark pops in at the peak with a scale 0 → 1.2 → 1 and a radial glow burst. |
| 1.10–1.90 s | Wordmark `QUESTRIX` appears with a **decode/scramble** effect (each letter cycles through random glyphs `A-Z0-9#%&` before locking in, staggered 50 ms per letter) plus a 2-frame RGB-split glitch. |
| 1.90–2.10 s | Tagline "Level up your real life." fades in. |
| 2.10–2.40 s | Whole splash scales to 1.04 and fades out to reveal the app. |

Requirements:
- Use **plain CSS keyframes + SVG** (preferred), with a few lines of JS only for the letter-scramble. If you use the `motion` package (formerly Framer Motion), use `LazyMotion` + `m` + `domAnimation`. No heavy libraries (no Lottie, no Three.js) — keep the JS for the splash under ~10 KB gzipped.
- `prefers-reduced-motion: reduce` → show static icon + wordmark for 600 ms, then fade out. No scramble or glitch.
- Must not block hydration or data fetching. Render it as an overlay (`position: fixed; inset: 0; z-index: 100`), while the app loads underneath.
- Set `aria-hidden="true"` on the decorative animation and include a visually-hidden "Loading Questrix" live region.

---

## 3. Tech stack (chosen for iPhone + desktop + scalability)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (latest stable, App Router) + TypeScript (strict)** | SSR/edge-ready, great PWA support, deploys to Vercel. |
| Styling | **Tailwind CSS (latest)** + CSS variables from 2.2 + `clsx` | Fast, consistent design tokens. |
| UI primitives | **Radix UI** primitives (dialog, dropdown, tabs, toast) | Accessible by default. |
| Backend / DB | **Supabase**: Postgres, Auth, Row Level Security, Realtime, Storage | Managed Postgres that scales; RLS gives per-user security with no custom auth server. |
| Data fetching | **TanStack Query** on the client, Supabase server client in Server Components / Route Handlers (`@supabase/ssr`) | Caching, optimistic updates. |
| Validation | **Zod** for every form and API input | One schema for client + server. |
| Push | **Web Push (VAPID)** via the `web-push` npm package in a Node.js route handler | Works on iOS 16.4+ for Home-Screen-installed PWAs, Android and desktop. |
| Scheduler | **Supabase `pg_cron` + `pg_net`** calling `POST /api/cron/reminders` every minute with a bearer secret | Minute-level reminders without paying for a higher Vercel cron tier. |
| PWA | Web app manifest via `app/manifest.ts` + a hand-written service worker `public/sw.js` (push, notification click, offline fallback page) | Full control; avoid plugins that lag behind Next.js releases. |
| Tests | **Vitest** + Testing Library (unit/component), **pgTAP** via `supabase test db` (SQL functions & RLS), **Playwright** (E2E, including an iPhone viewport) | |
| Lint/format | ESLint flat config with `eslint-config-next`, run as `eslint .` (Next.js 16 removed `next lint`) + Prettier + `tsc --noEmit` (`"typecheck": "tsc --noEmit"`) | |
| CI | **GitHub Actions** | |
| Hosting | **Vercel** (app) + **Supabase** (DB) | Both scale horizontally; free tiers to start. Note: the Supabase free tier pauses after a period of inactivity. |
| Package manager | **pnpm** | |

### 3.1 Scalability rules (apply everywhere)
- App servers are **stateless**; all state is in Postgres. No in-memory sessions.
- Every list endpoint uses **cursor pagination** (`created_at, id` keyset), never `OFFSET`, max page size 50.
- Every foreign key and every column in a `WHERE`/`ORDER BY` of a hot query has an index (listed in Section 5).
- Leaderboards are **pre-computed** (materialized view refreshed by `pg_cron` every 10 min), never computed per request.
- Feed uses keyset pagination + Supabase Realtime only for "new posts available" toasts (don't stream the whole feed).
- Images (avatar exports, post cards) go to Supabase Storage with cache headers; cosmetic assets are static SVGs in `/public/cosmetics` served from the CDN.
- Push sending is batched with a concurrency limit (e.g., `p-limit(20)`) and idempotent (Section 7).
- Rate limits enforced in the database (Section 6.6) so they hold across any number of app instances.

---

## 4. Project structure

```
questrix/
├─ .claude/
│  └─ agents/                 # Claude Code subagents (Section 10)
├─ .github/
│  ├─ workflows/ci.yml
│  ├─ ISSUE_TEMPLATE/{feature.yml,bug.yml,phase.yml}
│  ├─ pull_request_template.md
│  └─ CODEOWNERS
├─ app/
│  ├─ (auth)/login/page.tsx
│  ├─ (app)/layout.tsx         # bottom tab bar: Today · Habits · Feed · Shop · Profile
│  ├─ (app)/today/page.tsx
│  ├─ (app)/habits/{page.tsx,new/page.tsx,[id]/page.tsx}
│  ├─ (app)/feed/{page.tsx,[postId]/page.tsx}
│  ├─ (app)/shop/page.tsx
│  ├─ (app)/profile/{page.tsx,edit/page.tsx}
│  ├─ (app)/u/[username]/page.tsx
│  ├─ (app)/leaderboard/page.tsx
│  ├─ (app)/settings/page.tsx  # timezone, notifications, privacy, delete account
│  ├─ api/cron/reminders/route.ts
│  ├─ api/cron/leaderboard/route.ts (optional; can be pure pg_cron)
│  ├─ api/push/subscribe/route.ts
│  ├─ manifest.ts
│  ├─ icon.svg
│  └─ layout.tsx
├─ components/{brand,habits,avatar,feed,shop,ui}/
├─ lib/
│  ├─ supabase/{client.ts,server.ts,middleware.ts,types.ts}  # types.ts generated by `supabase gen types`
│  ├─ habits/{templates.ts,suggestions.ts,schedule.ts}
│  ├─ points/{levels.ts}       # display-only helpers; real math lives in SQL
│  ├─ push/{send.ts,vapid.ts}
│  └─ validation/*.ts          # Zod schemas
├─ public/{sw.js,offline.html,brand/,icons/,cosmetics/}
├─ supabase/
│  ├─ migrations/*.sql
│  ├─ seed.sql                 # shop items, demo data for local dev only
│  └─ tests/*.sql              # pgTAP
├─ tests/{unit,e2e}/
├─ scripts/generate-icons.ts
├─ docs/{ARCHITECTURE.md,DECISIONS.md,ECONOMY.md,RUNBOOK.md}
├─ CLAUDE.md
├─ .env.example
└─ README.md
```

---

## 5. Database schema (Supabase Postgres)

Create through migrations in `supabase/migrations/`. Enable **RLS on every table**. Use `timestamptz` for instants and `date` for user-local calendar days.

### 5.1 Enums
```sql
create type habit_difficulty as enum ('easy','medium','hard');
create type habit_category  as enum ('health','fitness','mind','learning','career','self_care','nutrition','finance','social','other');
create type item_category   as enum ('avatar_base','outfit','accessory','name_color','name_style','title','background','border','consumable');
create type item_rarity     as enum ('common','rare','epic','legendary');
create type ledger_reason   as enum ('completion','streak_milestone','purchase','undo','admin_adjust','refund');
create type report_status   as enum ('open','actioned','dismissed');
```

### 5.2 Tables

**profiles** (1:1 with `auth.users`, created by trigger on signup)
| column | type | notes |
|---|---|---|
| id | uuid PK → auth.users(id) on delete cascade | |
| username | extensions.citext unique not null | `check (username::text ~ '^[a-z0-9_]{3,20}$')` — cast to text because citext's `~` is case-insensitive. Supabase installs `citext` in the `extensions` schema. Normalise input to lowercase in the client. |
| display_name | text | ≤ 40 chars |
| bio | text | ≤ 160 chars |
| timezone | text not null default 'UTC' | IANA name; validated in a BEFORE INSERT/UPDATE trigger with `exists (select 1 from pg_timezone_names where name = new.timezone)` (not a CHECK — that would call a non-immutable function). Auto-detected on first login from `Intl.DateTimeFormat().resolvedOptions().timeZone`. |
| points_balance | int not null default 0 check (≥ 0) | spendable |
| lifetime_points | int not null default 0 | never decreases except via undo; drives level |
| current_streak | int not null default 0 | |
| longest_streak | int not null default 0 | |
| last_streak_date | date | last local date that counted toward the streak |
| streak_run_started | date | set to `D` whenever a new streak run starts (6.2 rule 5); keys milestone awards |
| streak_freezes | int not null default 0 check (0..2) | |
| is_private | bool not null default false | private = stats (points, streaks, heatmap) hidden from **everyone except the owner**; username, avatar and posts stay visible. (Follows need no approval, so "visible to followers" would not be private.) |
| created_at | timestamptz default now() | |

Column privileges: `revoke update on profiles from anon, authenticated; grant update (username, display_name, bio, timezone, is_private) on profiles to authenticated;` — so clients can never write points/streak columns even if RLS allows the row. (Supabase grants table privileges to both `anon` and `authenticated` by default.)

**Global DB rules (apply to every table and function):**
- Every user-reference column (`user_id`, `author_id`, `follower_id`, `reporter_id`, etc.) is `uuid not null references profiles(id) on delete cascade`, so deleting an account removes all of the user's data.
- Every SECURITY DEFINER function uses `set search_path = ''` and schema-qualifies every name (`public.habits`, `extensions.citext`), as Supabase recommends.
- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase's API exposes them. For every **internal-only** function (`due_reminders`, trigger functions, leaderboard refresh): `revoke execute on function … from public, anon, authenticated; grant execute on function … to service_role;`. Client RPCs (6.4) are granted to `authenticated` only.
- Trigger functions that touch another user's rows (like/comment counters, inbox notifications, report auto-hide, signup) are SECURITY DEFINER, so RLS doesn't block them.

**habits**
| column | type | notes |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| user_id | uuid → profiles(id) on delete cascade | index |
| title | text not null | 1–60 chars |
| description | text | ≤ 280 |
| category | habit_category not null | |
| difficulty | habit_difficulty not null default 'medium' | |
| icon | text | emoji or icon key |
| color | text | one of the token names |
| days_of_week | smallint[] not null default '{0,1,2,3,4,5,6}' | 0 = Sunday … 6 = Saturday, matches JS `getDay()` and Postgres `extract(dow)` |
| target_per_day | smallint not null default 1 check (1..5) | e.g., supplements twice a day = 2 |
| reminder_times | time[] not null default '{}' | local times, max 5 |
| reminders_enabled | bool not null default true | |
| template_key | text | which template it came from (for suggestions/analytics) |
| sort_order | int not null default 0 | |
| archived_at | timestamptz | soft delete; archived habits aren't scheduled. Set only via the `archive_habit(p_habit_id)` RPC. |
| created_at | timestamptz default now() | |
Index: `(user_id) where archived_at is null`. Limit: max 20 active habits per user (enforced in the insert trigger).
Column privileges: clients may insert/update only `title, description, category, difficulty, icon, color, days_of_week, target_per_day, reminder_times, reminders_enabled, template_key, sort_order` — never `user_id` (set by a default of `auth.uid()`), `archived_at` or `created_at`.

**daily_schedule** (server-maintained snapshot, the anti-cheat source for rest days)
`(user_id, local_date)` PK, `scheduled_count int not null`. Written once per user per local day — by the first `get_today()`/`complete_habit()` call of that day, or by a nightly `pg_cron` job that fills in any missing days — from the habits active at that moment. **Never** recomputed for past days, so editing a habit's `days_of_week` or archiving it can't turn a missed day into a rest day retroactively. No client write access.

**habit_completions**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| habit_id | uuid → habits on delete cascade | |
| user_id | uuid → profiles on delete cascade | |
| local_date | date not null | user's local date at completion time |
| occurrence | smallint not null | 1..target_per_day |
| base_points | int not null | |
| multiplier | numeric(4,2) not null | |
| points_awarded | int not null | |
| habit_current_before | int | `habit_streaks.current` before this completion (for undo) |
| habit_last_date_before | date | `habit_streaks.last_date` before this completion (for undo) |
| completed_at | timestamptz default now() | |
Unique `(habit_id, local_date, occurrence)`. Index `(user_id, local_date)`.

**daily_progress** (one row per user per local day that had activity)
| user_id | uuid | PK part |
| local_date | date | PK part |
| completed_count | int not null default 0 | |
| counted_for_streak | bool not null default false | |
| streak_before | int | the user's `current_streak` before this day counted; used by undo |
| last_streak_date_before | date | same, for undo |
| streak_freezes_before | smallint | same, for undo |
| streak_run_started_before | date | same, for undo |

**points_ledger** (append-only audit trail; the balance must always equal the sum)
| id | bigint identity PK |
| user_id | uuid, index `(user_id, created_at desc)` |
| delta | int not null (≠ 0) |
| reason | ledger_reason |
| ref_id | uuid (completion id / item id) |
| created_at | timestamptz default now() |
No update/delete grants for anyone except the service role.

**streak_milestones_awarded** — `(user_id, streak_run_started date, milestone int)` PK; prevents double-awarding a milestone within the same streak run.

**habit_streaks** (per-habit streaks, maintained inside `complete_habit`)
`(habit_id PK, current int, longest int, last_date date)`.

**items** (shop catalogue, seeded; read-only to clients)
| id | uuid PK |
| slug | text unique |
| name | text |
| description | text |
| category | item_category |
| rarity | item_rarity |
| price | int check (≥ 0) |
| asset | jsonb | e.g., `{"svg":"/cosmetics/outfits/neon-jacket.svg"}` or `{"css":"name-style-glitch"}` or `{"color":"#22E5FF"}` |
| level_required | int default 1 |
| is_active | bool default true |
| is_default | bool default false | free starter items granted at signup |

**user_items** — `(user_id, item_id)` PK, `acquired_at`. Consumables (Streak Freeze) are not stored here; they increment `profiles.streak_freezes`.

**equipped_cosmetics** — `user_id` PK, one nullable FK column per slot: `avatar_base_id, outfit_id, accessory_id, name_color_id, name_style_id, title_id, background_id, border_id`. Equipping is done via `equip_item()` (checks ownership + slot category).

**push_subscriptions**
| id | uuid PK |
| user_id | uuid, index |
| endpoint | text unique |
| p256dh | text |
| auth | text |
| user_agent | text |
| created_at, last_success_at | timestamptz |

**reminder_log** — `(habit_id, local_date, reminder_time)` PK, `sent_at`. Guarantees each reminder is sent at most once.

**follows** — `(follower_id, followee_id)` PK, check `follower_id <> followee_id`, index on `followee_id`.

**blocks** — `(blocker_id, blocked_id)` PK. Blocked users can't see each other's posts/comments or follow each other.

**posts**
| id | uuid PK |
| author_id | uuid, index `(author_id, created_at desc)` |
| body | text check (char_length between 1 and 1000) |
| attachment | jsonb | stats-card snapshot, e.g., `{"type":"weekly_summary","streak":12,"completions":31,"points":640}` — **generated server-side** by `create_post()`, never trusted from the client |
| like_count, comment_count | int default 0 | maintained by triggers |
| created_at | timestamptz, index `(created_at desc, id desc)` |
| deleted_at | timestamptz |
Column privileges: `revoke update on posts, comments from anon, authenticated; grant update (body, deleted_at) on posts, comments to authenticated;` — authors can edit or soft-delete, but never change `attachment` or the counters.

**post_likes** — `(post_id, user_id)` PK.
**comments** — `id, post_id (index), author_id, body (1..500), created_at, deleted_at`.
**reports** — `id, reporter_id, target_type ('post'|'comment'|'user'), target_id, reason (≤ 300), status report_status default 'open', created_at`. Unique `(reporter_id, target_type, target_id)`.
**notifications_inbox** (in-app) — `id, user_id, type ('like','comment','follow','milestone'), payload jsonb, read_at, created_at`.

**leaderboard_weekly** — materialized view: per user, sum of `points_ledger.delta` where `reason in ('completion','streak_milestone','undo')` for the current ISO week (UTC) — including `undo` so complete → undo → complete can't inflate scores — excluding private profiles; with a unique index on `user_id` so `refresh materialized view concurrently` works (don't create it `WITH NO DATA`). Refreshed every 10 minutes by `pg_cron`. Materialized views can't have RLS, so: `revoke all on leaderboard_weekly from anon, authenticated; grant select on leaderboard_weekly to authenticated;` and include only public fields (user id, username, week points).

### 5.3 RLS policies (summary — write each one explicitly and test it with pgTAP)
- `profiles`: select only where `id = auth.uid()`; update only where `id = auth.uid()`. RLS filters rows, not columns, so everyone else reads through a **`public_profiles` view** (owned by `postgres`, without `security_invoker`, so it bypasses base-table RLS). The view returns only public columns and returns null stats when `is_private` and the viewer isn't the owner. Grant select on the view to `authenticated` only.
- `habits`, `push_subscriptions`, `notifications_inbox`: owner only (`user_id = auth.uid()`), subject to the column grants above.
- `habit_completions`, `daily_progress`, `daily_schedule`, `habit_streaks`, `user_items`, `streak_milestones_awarded`: **select own rows only — no client insert/update/delete**. All writes happen through SECURITY DEFINER RPCs or triggers (otherwise users could forge streaks or grant themselves items).
- `equipped_cosmetics`: select for everyone (needed to render others' avatars); **no client writes** — only `equip_item()` and the signup trigger.
- `points_ledger`: select own rows only; no client writes.
- `items`: select where `is_active`; no client writes.
- `posts`/`comments`: select where not deleted and author not blocked in either direction; insert only via `create_post` / `create_comment` RPCs (rate limits); update/delete (soft) own only.
- `follows`, `post_likes`: insert/delete own rows only.
- `reports`: insert own; select own.
- Every SECURITY DEFINER function must `set search_path = ''` (schema-qualified names) and derive the user from `auth.uid()` — never from a parameter.

---

## 6. Game economy & server functions

All of this logic lives in **Postgres functions** (SECURITY DEFINER, single transaction, `select … for update` on the user's `profiles` row first to serialize concurrent calls). Document the formulas in `docs/ECONOMY.md` and keep the numbers in one `economy_config` table (key/value) so they can be tuned without code changes.

### 6.1 Points per completion
```
base_points:  easy = 10, medium = 20, hard = 35
multiplier  = 1 + 0.01 × min(current_streak_after_today, 50)      → 1.01 … 1.50 (streak after today is always ≥ 1)
points      = floor(base_points × multiplier)
```

### 6.2 Streak rules (global daily streak)
- A local day **counts** when the user completes **at least one** scheduled habit that day.
- A **rest day** is a local day whose `daily_schedule.scheduled_count = 0`. Rest days never break a streak. A day with **no** `daily_schedule` row is filled in by the nightly job, so a gap day that is still missing a row is treated as **not** a rest day (fail closed).
- On the first completion of a local day `D` (inside `complete_habit`):
  0. If `D < last_streak_date` (the user moved to a timezone further west) → treat `D` as `last_streak_date`: no streak change.
  1. If `last_streak_date = D` → nothing changes.
  2. Else find the missed days strictly between `last_streak_date` and `D` that were **not** rest days (check at most 7 days back; more than 7 → treat as broken).
  3. If missed = 0 → `current_streak += 1`.
  4. If 0 < missed ≤ `streak_freezes` → consume that many freezes, `current_streak += 1`.
  5. Otherwise → `current_streak = 1`, `streak_run_started = D` (new streak run). On a user's very first completion (`last_streak_date` null) → same as 5.
  6. `last_streak_date = D`, `longest_streak = greatest(longest_streak, current_streak)`; before changing anything, store `streak_before`, `last_streak_date_before`, `streak_freezes_before` and `streak_run_started_before` in `daily_progress` for undo.
- **Milestone bonuses** (once per streak run, recorded in `streak_milestones_awarded`):
  3 days = 25 · 7 = 75 · 14 = 150 · 30 = 400 · 60 = 800 · 100 = 1,500 · 180 = 3,000 · 365 = 5,000 points, keyed by `(user_id, streak_run_started, milestone)`. Each creates an in-app notification and a confetti animation on the client. A milestone revoked by undo is recorded as a negative ledger entry with reason `undo`.
- **Per-habit streak**: consecutive *scheduled* days for that habit where `completed occurrences ≥ target_per_day`. Unscheduled days are skipped (they don't break it). Display only; no points.
- The UI must show "at risk" state: if today is a scheduled day, nothing is completed yet, and it's after 18:00 local → show a streak-at-risk banner (and the 20:00 local "streak saver" push if enabled in settings).

### 6.3 Levels (display only, derived)
`level = floor(sqrt(lifetime_points / 50)) + 1` → level 2 at 50 pts, level 5 at 800, level 10 at 4,050, level 20 at 18,050. Some shop items require a level.

### 6.4 RPC functions (exposed through `supabase.rpc`)
| function | behaviour |
|---|---|
| `complete_habit(p_habit_id uuid)` | Lock profile; ensure today's `daily_schedule` row exists; verify habit belongs to `auth.uid()`, isn't archived, and is scheduled today (user-local date from `profiles.timezone`); occurrence = the **lowest unused** value in `1..target_per_day` for that habit and day, reject if none is free; update streak (6.2) on the day's first completion; compute points; insert completion + ledger rows; update balance, lifetime, `daily_progress`, `habit_streaks`; award milestones. Returns JSON `{points_awarded, multiplier, current_streak, milestone?, new_balance, level}`. |
| `undo_completion(p_completion_id uuid)` | Only for own completion, same local day, within **15 minutes** of `completed_at`, and only if `points_balance ≥ points_awarded` (prevents "complete → spend → undo" exploits). Deletes the completion, writes a negative `undo` ledger entry, decreases lifetime points, and restores `habit_streaks` from the completion's `habit_current_before` / `habit_last_date_before`. If, after the delete, the user has **no completions left on that local date** → restore `current_streak`, `last_streak_date`, `streak_freezes` and `streak_run_started` from `daily_progress.*_before`, and revoke any milestone awarded that day: delete the matching `streak_milestones_awarded` row and write a negative `undo` ledger entry. The whole undo is blocked if the balance can't cover every deduction. |
| `archive_habit(p_habit_id uuid)` / `unarchive_habit(p_habit_id uuid)` | Own habit only; sets/clears `archived_at` (the 20-active cap applies on unarchive). |
| `purchase_item(p_item_id uuid)` | Lock profile; item active; level requirement met; not already owned (non-consumables); balance ≥ price; insert `user_items` (or increment `streak_freezes`, max 2); negative `purchase` ledger entry; return new balance. |
| `equip_item(p_slot text, p_item_id uuid \| null)` | Validate ownership and that the item's category matches the slot; null = unequip (except `avatar_base`). |
| `create_post(p_body text, p_attach_summary bool)` | Rate limit; builds the attachment server-side from real data (last 7 days). |
| `create_comment(p_post_id uuid, p_body text)` | Rate limit; block check; creates inbox notification for the post author. |
| `get_today()` | Returns today's scheduled habits with completion counts, streak info, and balance in one round trip (used by the Today screen). |

### 6.5 Shop catalogue (seed in `supabase/seed.sql` *and* a migration for production items)
Price bands: **common 150–300 · rare 500–900 · epic 1,500–2,500 · legendary 5,000–8,000**. A user doing ~5 medium habits/day earns ~100–150 points/day, so a rare item takes about a week and a legendary about 1–3 months.

Seed at least:
- **Avatar bases (free, `is_default`)**: 4 body/skin-tone variants. Granted at signup.
- **Outfits (8)**: Starter Tee (free), Neon Hoodie, Cyber Jacket, Lab Coat, Ninja Gi, Astronaut Suit (epic), Mech Pilot Armor (legendary), Holo Robe (legendary).
- **Accessories (6)**: Headphones, Visor, Cat Ears, Halo, Jetpack, Holo Wings (legendary).
- **Name colours (8)**: Cyan, Violet, Magenta, Lime, Gold, Ice, Sunset gradient (epic), Aurora animated gradient (legendary).
- **Name styles (5)**: Bold Caps, Glow, Outline, Glitch (epic, CSS animation), Matrix Rain (legendary).
- **Titles (10)**: "Rookie" (free), "Early Bird", "Night Owl", "Code Monk", "Iron Will", "Supplement Sage", "Study Sorcerer", "Streak Lord" (requires level 10), "Unbreakable" (legendary), "Ascended" (legendary, level 20).
- **Backgrounds (6)**: Grid Void (free), Neon City, Starfield, Synthwave Sunset, Circuit Board, Nebula (legendary, animated).
- **Borders (6)**: Plain (free), Neon Ring, Hex Frame, Pulse (animated), Gold Laurel (epic), Plasma (legendary, animated).
- **Consumable**: Streak Freeze — 400 points, max 2 held.

Avatar rendering: `components/avatar/Avatar.tsx` stacks SVG layers in fixed order `background → border → avatar_base → outfit → accessory`, each from `/public/cosmetics/<category>/<slug>.svg` on a shared 256×256 viewBox. Draw the cosmetic SVGs as simple, original, flat-neon artwork (no copyrighted characters or brands). Name colour/style render via CSS classes. Animated cosmetics must respect `prefers-reduced-motion`.

### 6.6 Rate limits & anti-abuse (enforced in SQL)
- Posts: max 10 per hour, 50 per day per user. Comments: max 30 per hour. Follows: max 100 per day. Reports: max 20 per day.
- Body text: trimmed, length-checked; a basic profanity/slur filter (word list in `lib/moderation/blocklist.ts` checked client-side for UX **and** a matching SQL check) — flagged content is rejected with a friendly message.
- Auto-hide a post when it gets ≥ 5 open reports from distinct users (set `deleted_at`, keep for review).
- Account deletion (Settings) → `auth.admin.deleteUser` from a server route using the service role, cascading all user data.

---

## 7. Reminders & push notifications

### 7.1 Client
1. Service worker `public/sw.js` registered from a client component after load.
2. **Enable notifications** button in Settings and in onboarding. Permission must be requested **inside a user tap** (required by iOS Safari).
3. On iPhone, detect when the app is *not* running standalone (`window.matchMedia('(display-mode: standalone)').matches` false **and** `navigator.standalone` not true) and show an "Install Questrix" sheet: *Share → Add to Home Screen*, then open from the Home Screen and enable notifications. Push on iOS only works in the installed app on iOS/iPadOS 16.4+.
4. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })` → `POST /api/push/subscribe` (Zod-validated) → upsert `push_subscriptions` by endpoint.
5. `sw.js` handles `push` (show notification with title, body, icon `/icons/icon-192.png`, `data.url`) and `notificationclick` (focus an existing window or open `data.url`, e.g. `/today?habit=<id>`).

### 7.2 Server scheduler
- Secrets live in **Supabase Vault** and are created once per environment, **outside git** (SQL editor, documented in `docs/RUNBOOK.md`):
  `select vault.create_secret('https://your-app.vercel.app', 'app_url'); select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');`
- A migration enables `pg_cron` and `pg_net` and schedules the job, reading the secrets at run time:
```sql
select cron.schedule('questrix-reminders', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
```
  (pg_net's default timeout is only a few seconds, so it's raised here.)
- `GET|POST /api/cron/reminders` (Node.js runtime, `export const dynamic = 'force-dynamic'`):
  1. Reject unless the `Authorization` header equals `Bearer ${CRON_SECRET}` (constant-time compare).
  2. Call SQL function `due_reminders(now())` with the service-role client (EXECUTE revoked from `public`, `anon` and `authenticated` — see the global DB rules) which returns rows where, **in each user's timezone**: today's weekday ∈ `days_of_week`, a `reminder_time` falls in the window `(now − 2 min, now]` truncated to minutes, the habit isn't archived, today's completions < `target_per_day`, and no `reminder_log` row exists. It inserts the `reminder_log` rows in the same statement (`insert … on conflict do nothing returning …`) so overlapping cron runs can't double-send.
  3. Send with `web-push` (VAPID keys from env), concurrency 20, TTL 1 hour, `urgency: 'high'`. On HTTP 404/410 delete the subscription; on success update `last_success_at`.
  4. Return `{sent, failed, removed}` and log it.
- Notification copy is playful and varied (pick randomly from a list per category), e.g.:
  - "🧴 Night care time — your future face says thanks. +20 pts waiting."
  - "💊 Supplements check! Keep the 12-day streak alive 🔥"
  - "📚 Study block starts now. Hard mode = 35 pts."
  - "💻 Push those commits to GitHub — streak ×1.12 active."
- Optional daily **streak saver** at 20:00 local if a streak ≥ 3 is at risk (user setting, default on).

### 7.3 Env vars (`.env.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only, never NEXT_PUBLIC
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=                # server only
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=
NEXT_PUBLIC_APP_URL=
```
Generate VAPID keys with `pnpm dlx web-push generate-vapid-keys`.

---

## 8. Habit templates & smart suggestions (for adding new tasks)

### 8.1 Template library (`lib/habits/templates.ts`)
Each template: `{ key, title, category, difficulty, icon, defaultDays, targetPerDay, defaultTimes, tip }`. Ship at least these 30:

| Category | Templates (default time) |
|---|---|
| self_care | Night skincare routine (21:30) · Morning skincare + SPF (07:30) · Floss (22:00) · Screen-off 30 min before bed (22:30) |
| nutrition | Take supplements (08:00, ×2 → also 20:00) · Follow my diet plan (12:00) · Drink 2 L of water (×4: 09:00, 12:00, 15:00, 18:00) · Log meals (20:00) · No sugary drinks (12:00) |
| learning | Study session 45 min (18:00) · Review flashcards 15 min (07:45) · Read 20 pages (21:00) · Language practice 15 min (12:30) |
| career | Push commits to GitHub (20:00) · LeetCode / practice problem (19:00) · Plan tomorrow's top 3 tasks (21:00) · Inbox zero (16:30) |
| fitness | Workout (17:30) · 8,000 steps (19:00) · Stretch 10 min (07:15) · Go for a walk (13:00) |
| mind | Meditate 10 min (07:00) · Journal 3 lines (22:00) · Gratitude list (21:45) |
| health | Sleep by 23:00 (22:45) · Take medication (time set by user) · Make bed (07:20) |
| finance | Log expenses (20:30) · No-spend check (21:00) |
| social | Message a friend or family member (18:30) |

### 8.2 Suggestion engine (`lib/habits/suggestions.ts`, pure TypeScript, fully unit-tested, no AI/LLM required)
Shown on the **Add Habit** screen as a "Suggested for you" carousel plus inline tips while the user types. Rules, scored and sorted:
1. **Complementary pairs** (+40): if the user has X, suggest Y. Examples: Night skincare → Morning skincare + SPF; Study session → Review flashcards; Push commits → Plan tomorrow's top 3; Workout → Stretch; Follow diet → Log meals; Supplements → Drink water.
2. **Category gaps** (+25): categories with zero active habits, prioritising health, mind, fitness.
3. **Time-slot gaps** (+15): if no habits in the morning (05–11), midday (11–17) or evening (17–23), suggest a template whose default time falls in that slot.
4. **Not already added** (hard filter): exclude templates whose `template_key` the user already has, or whose title matches fuzzily (case-insensitive similarity above 0.8).
5. **Social proof** (+10, Phase 7+): templates popular among people the user follows (aggregated counts only, no personal data).

**Coaching rules while creating a habit** (inline hints, never blocking):
- More than 5 active habits in the first week → "Starting with 3–5 habits makes streaks 2× easier to keep. Add anyway?"
- More than 8 active → stronger warning; hard cap at 20.
- Vague title (≤ 2 words, no number/time, e.g., "Study") → suggest making it specific: "Study 45 min for [exam]".
- Reminder time collides (±10 min) with an existing reminder → suggest stacking: "Stack it with *Take supplements* at 08:00?"
- Hard difficulty with target_per_day > 2 → "This is a lot — consider medium difficulty or fewer reps."
- Suggest **habit stacking** copy: "After I [existing habit], I will [new habit]."

**Optional stretch (separate issue, Phase 8):** "Verify with GitHub" for the commit habit — the user links GitHub via OAuth and the server checks the public events API for a push event today before awarding a bonus +10. Must be opt-in.

---

## 9. Screens & UX (mobile-first, then responsive up to desktop)

- **Onboarding** (3 steps): pick username + avatar base → pick 3 starter habits from templates (with suggestions) → enable notifications (with the iOS install sheet when needed).
- **Today**: greeting + level/XP ring + streak flame with count + points balance; list of today's habits as big tappable cards (tap = complete; progress pips for multi-per-day; long-press/⋯ = undo within 15 min). Completing shows a "+20 ×1.12" floating number, haptic (`navigator.vibrate` where supported; iOS Safari ignores it — fine), and a confetti burst on milestones.
- **Habits**: manage list, drag-to-reorder, archive, edit; Add Habit (templates, suggestions, form).
- **Feed**: Following / Everyone tabs, compose post with "attach my weekly summary" toggle, likes, comments, report, block.
- **Shop**: tabs per category, rarity-coloured cards, live avatar preview before buying, confirm dialog showing balance after purchase.
- **Profile**: avatar with equipped cosmetics, coloured/styled name, title, level, streaks, heatmap calendar of the last 12 weeks, badges/milestones, posts. Edit = equip items.
- **Leaderboard**: weekly top 100 + "You are #N" + Friends tab.
- **Settings**: timezone, notifications (per-habit toggles, streak saver), privacy, block list, export my data (JSON), delete account, sign out.

Accessibility & quality bar: tap targets ≥ 44×44 px, full keyboard navigation, visible focus rings, `aria-live` for points/streak updates, respects reduced motion, `env(safe-area-inset-*)` padding with `viewport-fit=cover` for the iPhone notch/home bar, works offline for viewing Today (cached) with an offline banner; completions while offline are **not** queued (server is authoritative) — show "You're offline" instead.

Auth: Supabase Auth with **email magic link** and **Google OAuth**. (Sign in with Apple can be added later; it needs a paid Apple Developer account.)

---

## 10. Claude Code subagents (create in Phase 0)

Create these files in `.claude/agents/`. They are used in every phase.

**`.claude/agents/planner.md`**
```markdown
---
name: planner
description: Breaks a Questrix build phase into a small ordered task list with acceptance criteria. Use at the start of every phase before writing code.
tools: Read, Grep, Glob
---
You are the technical planner for Questrix. Read QUESTRIX_BUILD_PLAN.md (or docs/ copies of it), CLAUDE.md and the current codebase.
For the requested phase, output: (1) an ordered task list (max ~12 items), each with files touched and acceptance criteria; (2) risks and open questions; (3) which tests prove it works.
Do not write code. Flag anything in the plan that conflicts with current library docs or with existing code.
```

**`.claude/agents/code-reviewer.md`**
```markdown
---
name: code-reviewer
description: Reviews the current branch's diff against main for correctness, security, RLS, performance and plan compliance. Use before every PR is marked ready and after each fix round.
tools: Read, Grep, Glob, Bash
---
You are a strict senior reviewer for Questrix. Run `git diff main...HEAD` and read the changed files in full.
Check: correctness and edge cases (timezones, midnight boundaries, DST, concurrency); security (RLS on every table, no service-role key in client code, SECURITY DEFINER functions set search_path and use auth.uid(), input validated with Zod, no secrets committed); the economy rules in Section 6 are implemented exactly; accessibility; performance (indexes, pagination, N+1 queries); tests exist and are meaningful.
Output a Markdown review with sections: **Blocking**, **Should fix**, **Nits**, **Looks good**. Cite file:line for each finding. Do not edit files.
```

**`.claude/agents/test-writer.md`**
```markdown
---
name: test-writer
description: Writes missing unit, pgTAP and Playwright tests for the current phase. Use after implementation and before review.
tools: Read, Grep, Glob, Edit, Write, Bash
---
You write tests for Questrix. Find untested logic in the current branch diff and add tests: Vitest for TypeScript, pgTAP (supabase/tests) for SQL functions and RLS policies, Playwright for user flows (include an iPhone 13 device profile).
Prioritise: points/streak math, timezone and DST edges, undo exploits, purchase concurrency, RLS denial cases. Run the tests and make them pass without weakening assertions.
```

**`.claude/agents/security-auditor.md`**
```markdown
---
name: security-auditor
description: Audits Supabase RLS policies, SQL functions, API routes and secrets handling. Use in Phases 2, 4, 6, 7 and 8.
tools: Read, Grep, Glob, Bash
---
Audit Questrix for: tables without RLS; policies that let a user read/write another user's private data; clients able to change points, streaks, balances or inventory; SECURITY DEFINER functions without `set search_path`; trusting user-supplied IDs instead of auth.uid(); missing rate limits; XSS in posts/comments; secrets in code or logs; the cron route reachable without the secret.
Report findings by severity (Critical/High/Medium/Low) with file:line and a concrete fix. Do not edit files.
```

Also create **`CLAUDE.md`** at the repo root containing: a short project summary, the commands (`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `supabase start`, `supabase db reset`, `supabase test db`, `supabase gen types typescript --local > lib/supabase/types.ts`), the "server is authoritative for points" rule, the GitHub workflow summary from Section 11, and "copy this plan to `docs/BUILD_PLAN.md` and keep it updated".

---

## 11. GitHub workflow (applies to every phase)

### 11.1 One-time setup (Phase 0)
1. Verify `gh auth status`. If not logged in, **stop and ask the human** to run `gh auth login`.
2. `git init -b main`, create the repo: `gh repo create questrix --private --source=. --remote=origin` (ask the human whether it should be public or private first).
3. Labels: `phase-0` … `phase-8`, `type:feature`, `type:bug`, `type:chore`, `type:security`, `type:test`, `priority:high`, `priority:medium`, `priority:low`, `needs-review`.
4. Milestones: one per phase, named like `Phase 3 — Habits & Suggestions`.
5. Issue templates (`feature.yml`, `bug.yml`, `phase.yml`), `pull_request_template.md` with sections: Summary · Linked issues (`Closes #…`) · Screenshots (mobile + desktop) · How to test · Checklist (tests added, RLS checked, a11y checked, no secrets, docs updated).
6. Make an initial commit (README, `.gitignore`, this plan) and `git push -u origin main` **before** enabling branch protection. The rest of Phase 0 goes through a PR from `phase-0/bootstrap`.
7. **Branch protection** on `main` (via `gh api`; private repos on a free GitHub plan can't use it, so if it's unavailable, note that in `docs/DECISIONS.md` and continue): require a PR, require the status checks of **every CI job by its exact job name** (`ci`, `db-tests`, and `e2e` once it exists — a required check matches job names, not the workflow file name), no force pushes, require linear history. Add each new job to the required checks when it's created.
8. CI (`.github/workflows/ci.yml`) on `pull_request` and `push` to main. The main job is named `ci`: checkout → setup pnpm + Node LTS with cache → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` (with dummy public env values). A second job named `db-tests` runs `supabase start` + `supabase db reset` + `supabase test db` using `supabase/setup-cli`. An `e2e` Playwright job from Phase 3 onward (install browsers with `pnpm exec playwright install --with-deps`).
9. Add Dependabot (`.github/dependabot.yml`) for npm and GitHub Actions, weekly.

### 11.2 Per-phase loop
1. Create a **tracking issue** for the phase (template `phase.yml`, label `phase-N`, milestone) with the phase's goals and acceptance criteria copied from Section 12.
2. Run the `planner` subagent; post its task list as a comment on the tracking issue: `gh issue comment <n> --body-file plan.md`.
3. Create one **issue per task** (label + milestone), each linked to the tracking issue.
4. `git switch -c phase-N/<short-slug>`.
5. Implement in small **Conventional Commits** (`feat:`, `fix:`, `test:`, `chore:`, `docs:`), each referencing an issue (`refs #12`).
6. Run `test-writer`, then run everything locally: lint, typecheck, unit, db tests, build (and E2E when applicable). All green before pushing.
7. `git push -u origin HEAD` and `gh pr create --draft --fill` with the PR template filled in, `Closes #…` for every task issue + the tracking issue, label `needs-review`, milestone set.
8. Run `code-reviewer` (and `security-auditor` where Section 10 says so). Post the review on the PR with `gh pr review <n> --comment --body-file review.md` (GitHub doesn't allow approving your own PR, so use `--comment`).
9. Fix all **Blocking** and **Should fix** items in new commits; re-run the reviewer until there are no Blocking items; post the final review as another comment.
10. `gh pr ready <n>`, then `gh pr checks <n> --watch` until CI is green.
11. **Stop and ask the human**: "Phase N PR #<n> is ready and CI is green — merge?" Only after a yes: `gh pr merge <n> --squash --delete-branch`, `git switch main && git pull`.
12. Tag: `git tag v0.N.0 && git push --tags`, and create a release with notes: `gh release create v0.N.0 --generate-notes`.

### 11.3 Bugs found along the way
Open a `type:bug` issue immediately with steps to reproduce; fix it in the current phase if it's in scope, otherwise assign it to the right milestone.

---

## 12. Build phases

Each phase lists **Deliverables** and **Acceptance criteria** (copy them into the tracking issue). Each phase ends with a PR as described in 11.2.

### Phase 0 — Repo, tooling, CI, agents · `v0.0.0`
- Deliverables: everything in 11.1; Next.js + TypeScript (strict) + Tailwind + ESLint + Prettier + Vitest scaffold with pnpm; `.claude/agents/*` and `CLAUDE.md` (Section 10); `docs/` skeletons; copy this file to `docs/BUILD_PLAN.md`; Supabase CLI initialized (`supabase init`); `.env.example`; README with setup steps.
- Acceptance: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally and in CI; repo has labels, milestones, templates, protected `main`; a trivial test exists.

### Phase 1 — Brand, design system, launch splash, PWA shell · `v0.1.0`
- Deliverables: colour tokens and fonts (2.2); `icon.svg` and generated PNG icons (2.3); `LaunchSplash` (2.4); `app/manifest.ts` (name "Questrix", short_name "Questrix", `display: "standalone"`, `background_color` and `theme_color` `#070A12`, start_url `/today`, icons incl. maskable); `public/sw.js` with offline fallback `offline.html`; app shell with bottom tab bar (placeholder pages); base UI components (Button, Card, Sheet, Toast, Tabs, ProgressRing).
- Acceptance: Chrome DevTools → Application → Manifest shows no installability errors (Lighthouse no longer has a PWA category); Lighthouse (mobile) Accessibility ≥ 95; app installs to an iPhone Home Screen with the correct icon and opens standalone without browser chrome; splash plays once per session, is skippable, and is replaced by the static version under reduced motion; component tests for `LaunchSplash` (renders, skips on tap, reduced-motion branch).

### Phase 2 — Auth, profiles, onboarding (part 1) · `v0.2.0`
- Deliverables: Supabase Auth (magic link + Google); `@supabase/ssr` session refresh and route protection in `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`; use `middleware.ts` only on Next ≤ 15); `profiles` table + signup trigger (creates profile, grants default items, creates `equipped_cosmetics` row); the `items`, `user_items` and `equipped_cosmetics` tables + RLS and the seeded **free default items** (avatar bases, Starter Tee, Rookie title, Grid Void background, Plain border) are created **in this phase** because the trigger and onboarding need them (Phase 6 adds the paid catalogue, the shop, `purchase_item` and `equip_item`); username picker with availability check; timezone auto-detect + edit in Settings; RLS + column privileges for `profiles`.
- Acceptance: pgTAP tests prove a user can't update another profile or their own `points_balance`; E2E: sign up → pick username → land on Today; `security-auditor` run with no Critical/High findings.

### Phase 3 — Habits, templates, suggestions · `v0.3.0`
- Deliverables: `habits` table + RLS + 20-habit cap; CRUD UI (create/edit/archive/reorder); template library (8.1) and suggestion engine + coaching hints (8.2); onboarding step 2 (pick 3 starter habits); `lib/habits/schedule.ts` (is-scheduled-today in user tz).
- Acceptance: unit tests for every suggestion rule and coaching hint; schedule tests including DST transitions (e.g., America/Toronto in March and November) and a UTC+13 timezone; E2E creates a habit from a template on an iPhone viewport; Playwright CI job enabled.

### Phase 4 — Completions, points, streaks (the game engine) · `v0.4.0`
- Deliverables: `habit_completions`, `daily_progress`, `points_ledger`, `habit_streaks`, `streak_milestones_awarded`, `economy_config`; `complete_habit`, `undo_completion`, `get_today` functions; Today screen with completion animation, floating points, streak flame, level ring, streak-at-risk banner, milestone confetti.
- Acceptance (pgTAP, all required):
  - points = floor(base × multiplier) for each difficulty at streak-after-today 1, 2, 25, 50, 80;
  - editing `days_of_week` or archiving a habit after missing a day does **not** turn that day into a rest day (uses `daily_schedule`); moving to a timezone further west doesn't break or double-count the streak;
  - with target 3: complete #1 and #2, undo #1, complete again → succeeds (reuses occurrence 1);
  - completing beyond `target_per_day` is rejected; completing an unscheduled or archived habit is rejected; completing another user's habit is rejected;
  - streak increments on consecutive days, survives rest days, consumes freezes correctly, resets after a real miss;
  - each milestone is awarded exactly once per streak run;
  - undo restores balance, lifetime points, streak, freezes, streak-run start and per-habit streak exactly, fails after 15 min, fails on a previous day, and fails when the balance was spent;
  - two concurrent `complete_habit` calls for the same habit can't create duplicate occurrences (unique constraint + row lock);
  - invariants hold after a randomized sequence of complete/undo/purchase actions (property-style test): `sum(points_ledger.delta) = points_balance` (purchases are negative entries) and `sum(delta) where reason in ('completion','streak_milestone','undo') = lifetime_points`.
  - `security-auditor` run with no Critical/High findings.

### Phase 5 — Reminders & push notifications · `v0.5.0`
- Deliverables: everything in Section 7; Settings → notifications (global toggle, per-habit toggle, streak saver); iOS install sheet; onboarding step 3; `docs/RUNBOOK.md` with VAPID + Vault + pg_cron setup.
- Acceptance: unit tests for `due_reminders` across timezones (including a user whose local date differs from UTC's), the 2-minute look-back window `(now − 2 min, now]`, the already-completed exclusion, and idempotency (running twice sends once); route returns 401 without the secret; 404/410 subscriptions are removed (mocked `web-push`); manual test checklist for a real iPhone in the PR description.

### Phase 6 — Avatar, shop, inventory, profile customization · `v0.6.0`
- Deliverables: the paid catalogue (the tables already exist from Phase 2); seeded catalogue (6.5) with original SVG art; `purchase_item`, `equip_item`; Shop screen with live preview; Profile screen with avatar, name colour/style, title, background, border, level, 12-week heatmap; Streak Freeze purchase.
- Acceptance: pgTAP for insufficient balance, double purchase, level lock, freeze cap of 2, equipping an unowned item or the wrong slot, concurrent purchases not overspending; visual check of every cosmetic at 64 px and 256 px; `security-auditor` clean.

### Phase 7 — Social: follows, feed, posts, comments, leaderboard · `v0.7.0`
- Deliverables: `follows`, `blocks`, `posts`, `post_likes`, `comments`, `reports`, `notifications_inbox`; `create_post` with server-built weekly summary card; feed with Following/Everyone tabs and keyset pagination; likes/comments with counters; public profile `/u/[username]` respecting privacy; report + block flows; auto-hide at 5 reports; weekly leaderboard materialized view + pg_cron refresh; Realtime "new posts" toast; social-proof suggestions (8.2 rule 5).
- Acceptance: pgTAP for rate limits, block visibility both directions, private profile hiding, report auto-hide, counters staying correct under like/unlike; XSS test (post containing `<script>` renders as text); feed pagination E2E; `security-auditor` clean.

### Phase 8 — Hardening, performance, launch · `v1.0.0`
- Deliverables: full RLS audit; Sentry (or Vercel monitoring) for errors; data export (JSON) and account deletion; empty/error/loading states everywhere; performance pass (bundle analysis, image/font optimization, route-level code splitting); a11y pass; Vercel + Supabase production setup documented step by step in `docs/RUNBOOK.md` (env vars, Vault secrets, pg_cron job, Auth redirect URLs, custom domain optional); optional GitHub-verify stretch issue.
- Acceptance: Lighthouse mobile ≥ 90 for Performance, Accessibility, Best Practices; all CI jobs green; `security-auditor` reports no Critical/High; E2E full journey on iPhone viewport (sign up → onboarding → complete habits → streak → buy item → equip → post → like) passes; README has "Install on iPhone" instructions.

---

## 13. Definition of done (every PR)
- [ ] Lint, typecheck, unit, DB, build (and E2E when present) pass locally and in CI.
- [ ] New SQL tables have RLS + policies + pgTAP tests; any SECURITY DEFINER function sets `search_path` and uses `auth.uid()`.
- [ ] No secrets, no `service_role` key in client bundles (`grep -r SERVICE_ROLE app components lib` only hits server-only files marked with `import 'server-only'`).
- [ ] Mobile (iPhone 13 viewport) and desktop screenshots in the PR.
- [ ] Reduced-motion and keyboard navigation checked for new UI.
- [ ] `docs/` updated (DECISIONS, ECONOMY, RUNBOOK as relevant).
- [ ] `code-reviewer` has no Blocking findings; review posted on the PR.
- [ ] Human approved the merge.
