# Decisions

A running log of choices made where the plan was ambiguous or where current tooling differed from it.

## Workflow

- **One PR per task, rebase-merged (from Phase 3, #29).** Plan §11.2 originally had one PR per phase, squash-merged, which put a whole phase on `main` as a single commit. Now each task issue gets its own branch and PR, merged with `--rebase` so the individual Conventional Commits stay on `main`. That keeps the history readable step by step and satisfies the linear-history rule. The tag and release still happen once per phase.

## Phase 0

- **Repository visibility:** the repo `IshaanMittal07/Questrix` already existed and is **public**, so it was reused instead of running `gh repo create`. Because it's public, branch protection is available.
- **Typecheck script:** `next typegen && tsc --noEmit` instead of plain `tsc --noEmit`. Next 16 generates global route types (`LayoutProps`, `PageProps`) into `.next/types`, and a clean CI checkout doesn't have them until `next typegen` runs.
- **Node floor 22.22.2 (#57).** jsdom was held at ^29 while the local machine ran Node 22.14. Dependabot's jsdom 31 (#17) was merged on 2026-11-16 without catching that hold. jsdom 31 and its dependency `w3c-xmlserializer@6` need `^22.22.2 || ^24.15.0 || >=26`, and undici 8 needs `>=22.19`.
  - `engines.node` is therefore `>=22.22.2 <23`. It is bounded to the 22 line because Vercel takes its Node major from `engines`, and `@types/node` and `.nvmrc` are pinned to 22. Move all three together.
  - `engineStrict: true` in `pnpm-workspace.yaml` makes `pnpm install` fail on an older Node, instead of Vitest workers crashing inside undici. Scripts still run.
  - CI uses `.nvmrc` (`22`, the latest 22), so it doesn't test the exact floor.
- **Supabase CLI as a devDependency** (`supabase` npm package, run with `pnpm exec supabase` or the `db:*` scripts), so the version is pinned in the lockfile. CI uses `supabase/setup-cli` with the same version.
- **Line endings:** `.gitattributes` forces LF and Prettier uses `endOfLine: lf`, so Windows checkouts and CI agree.
- **Plan copies:** `QUESTRIX_BUILD_PLAN.md` (the original) stays at the root and `docs/BUILD_PLAN.md` is the maintained copy, as plan §10 asks. Both are excluded from Prettier so they stay verbatim.
- **create-next-app extras:** Next 16's scaffold adds `AGENTS.md` (Next.js agent rules, which say to read `node_modules/next/dist/docs/` before coding), enables `cacheComponents` and `partialPrefetching`, and uses `@tailwindcss/turbopack`. All of these are kept as generated.
- **pgTAP smoke test** (`supabase/tests/000_smoke.sql`) exists so `supabase test db` has something to run before Phase 2 adds real tables.
- **Branch protection on `main`:** PRs are required, with **0 required approvals**, because GitHub doesn't let you approve your own PR and this is a solo repo. Required checks are `ci` and `db-tests` (strict, so the branch must be up to date), linear history is on, force pushes and deletions are off, and the rules apply to admins too. Add `e2e` to the required checks in Phase 3 (done, #42).
- **CI `db-tests`** starts Supabase without studio, imgproxy, mailpit, edge-runtime, logflare, vector, supavisor and postgres-meta, which DB tests don't need. That brought the job from about 1m47s to 1m04s.

## Phase 1

- **Splash without a flash:** an inline `<head>` script (the `InlineScript` helper, following the Next 16 guide "Preventing flash before hydration") sets `html[data-splash="seen"]` when `sessionStorage` says the splash already played, and CSS hides the server-rendered overlay before first paint. The splash's CSS animations start from the server HTML, so they don't wait for hydration.
- **The splash marks itself seen when it starts**, not when it finishes. Reloading mid-animation won't replay it.
- **CSS owns the splash timeline.** The overlay unmounts on its own `qx-out` `animationend` event. The scramble starts on the wordmark's `qx-in` `animationstart` event, which fires at 1.1 s of the CSS timeline. JS timers measured from navigation start would drift from what's actually painted when the first paint or hydration is slow. A fallback timer (`max(0, 2400 − performance.now()) + 600 ms`) only covers animation events that never arrive. If hydration misses the reveal, the wordmark stays static.
- **The splash can't block the app.** `qx-out` ends with `visibility: hidden; pointer-events: none`, so the overlay can't block taps even if JS never loads. Skip happens on `click` rather than `pointerdown` to avoid ghost clicks, and the key listener is removed once the splash closes.
- **Wordmark scramble:** 40 ms ticks. Each letter locks 300 ms + i×50 ms after the reveal, so the last one locks at about 1.75 s. The 2-frame RGB glitch is a CSS `text-shadow` animation at 1.8 s.
- **Reduced motion:** CSS shows the static art and fades out at 600 ms, then `animationend` closes the splash. There's no scramble.
- **Test setup:** `tests/setup/polyfills.ts` adds `AnimationEvent` to jsdom before react-dom loads. Without it, React listens for `webkitAnimationEnd` and the animation handlers can't be tested.
- **Navigation, not tabs:** the bottom bar is `<nav>` + `<Link aria-current="page">` rather than Radix Tabs, because it navigates between routes. Radix Tabs is for in-page panels.
- **Suspense around the TabBar:** `usePathname` can suspend under `cacheComponents` for dynamic routes, so `TabBar` is wrapped in `<Suspense>` with a static, non-highlighted fallback.
- **Theme colour** is set through the `viewport` export (`themeColor`, `colorScheme`, `viewportFit: "cover"`), because those keys are deprecated in `metadata`.
- **Apple icon:** `metadata.icons.apple` points to `public/icons/apple-touch-icon.png` (as the plan specifies) rather than the `app/apple-icon.png` file convention.
- **`/` redirects to `/today`** (307) through `next.config.ts` `redirects()`.
- **Service worker:** registered only in production, with `updateViaCache: "none"`. It does network-first navigations with an `offline.html` fallback and caches nothing else, because the server is authoritative. `/sw.js` is served with `no-store` and its own CSP, following the Next PWA guide. Security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`) apply site-wide.
- **Primary buttons use dark text** (`--bg`) on the brand gradient, because white on `--neon-violet` is only about 4.1:1.
- **pnpm `allowBuilds`:** `esbuild: true` is needed for `tsx`, which runs `scripts/generate-icons.ts`.

## Phase 2

- **Placeholder username + `onboarded_at`.** `profiles.username` is `not null`, but the profile is created at signup, before the user picks a name. The signup trigger sets `user_<12 hex>`. A `BEFORE UPDATE` trigger sets `onboarded_at` the first time the username changes, and clients can't write that column. `proxy.ts` sends users without `onboarded_at` to `/onboarding`. `public_profiles` hides users who haven't onboarded.
- **`equip_item` lands in Phase 2** (the plan schedules it for Phase 6), because onboarding step 1 picks an avatar base and `equipped_cosmetics` has no client writes.
- **Default items are created by a migration**, not only `seed.sql`, because production signups depend on them.
- **Sign-in is a 6-digit email code first, with the link second.** An installed iOS PWA doesn't share cookies with Safari, so a tapped magic link would sign into Safari instead of the app. The email template (`supabase/templates/magic_link.html`) carries the code and a `token_hash` link to `/auth/confirm`. Unlike the default PKCE link, that link works in any browser. **The same template has to be set in the hosted Supabase dashboard** (see the RUNBOOK).
- **Reserved usernames** (`admin`, `today`, `u` and so on) are rejected by `username_available`.
- **`proxy.ts`** validates the session with `auth.getClaims()` (not `getSession()`) and refreshes cookies. It caches the onboarding check in an httpOnly `qx-onboarded=<user id>` cookie, so it doesn't hit the DB on every request. Server Actions re-check `auth.getClaims()` themselves.
- **`createClient()` on the server calls `await connection()`.** Per-user data is always request-time. supabase-js also reads `Date.now()`, which Next 16's prerender rejects without it.
- **Local Supabase ports are 55321–55329** instead of the default 543xx, so it can run next to other local Supabase projects. The Google OAuth redirect URI for local dev is therefore `http://127.0.0.1:55321/auth/v1/callback`.
- **Playwright arrived in Phase 2** (the plan says Phase 3), so the Phase 2 sign-up E2E could run. Locally it uses the installed Chrome; CI installs Chromium. The iPhone 13 project emulates the viewport and touch on Chromium. The E2E reads the sign-in code from Mailpit.
- **`public_profiles`** is a view without `security_invoker`, as the plan intends. Supabase's `security_definer_view` advisor will flag it. It exposes only public columns, nulls private stats and is granted to `authenticated` only.
- **Security review fixes:**
  - Email confirmations are on, to stop account pre-hijacking with a password signup. Sign-in codes expire after 15 minutes.
  - Reserved usernames (including the `user_` placeholder prefix) are enforced in the `profiles` trigger, not just the RPC.
  - `/auth/confirm` accepts only an allowlist of OTP types.
  - Timezone validation runs only when the value changes.
  - An unusable device timezone falls back to UTC, so onboarding can't get stuck.
- **Accepted risk:** the `qx-onboarded` cookie is an unsigned per-user cache of the onboarding check. Forging it only lets a user skip their _own_ onboarding redirect. All data access is still enforced by RLS and RPCs. If a later onboarding step must be mandatory, sign it with an HMAC.
- **Production checklist** (see RUNBOOK): confirmations on, OTP expiry ≤ 900 s, Google `skip_nonce_check = false`.
- **Review round 2 (PR #27):**
  - **Auth is strictly passwordless.**
    - Confirmations alone didn't stop pre-hijack. Locally, a password signup followed by the victim's code sign-in left the attacker's password working.
    - The `strip_auth_password` trigger on `auth.users` now stores `''` for every insert or password update, so a password can never be planted at signup or later from a stolen session.
    - `secure_password_change` is on and `minimum_password_length` is 8 as a second layer. A future password feature would have to drop the trigger deliberately.
  - **`/auth/confirm` is a page with a button that POSTs** (a server action), not a GET route handler, so mail link scanners can't burn the one-time token. The OTP type allowlist is now just `email`, the only type our templates issue.
  - **CAPTCHA (Turnstile) is wired but off** until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set and CAPTCHA is enabled in hosted Auth. Local dev and CI run without it.
  - **Item foreign keys use `on delete restrict`.** Items are retired with `is_active`, never deleted, so paid inventory can't vanish silently.
  - **`public_profiles` is `security_barrier`.**
  - **Deferred to Phase 4:** limit timezone changes. Unlimited changes would let a user moving east gain a local day for streaks and points. Tracked in #28.
- **Review round 3 (PR #27):**
  - **`safeNextPath` hardening:** it rejects control characters and backslashes, then resolves the path against a dummy origin. Both the origin and the _normalised output_ are checked: the output must start with `/` and not `//`. This closes `/%09/evil.com` (browsers strip the tab) and `/..//evil.com` (dot segments collapse to `//evil.com`).
  - **`/auth/confirm` takes no `next` parameter.** Our templates never set one, and a fixed destination (`/onboarding` or `/today`) leaves nothing to abuse as a redirect.
  - **Accepted risk: login CSRF through email links.** Anyone holding a valid `token_hash` link for their own account can get a victim to tap it and be signed in as them. The confirm button doesn't prevent this; it only stops mail scanners from using up the token. Showing "Signed in as …" after sign-in is a candidate for Phase 7 (social), when the risk matters more.
  - **Check before Phase 6:** `public_profiles` is `security_barrier`, so a `username = $1` lookup (citext equality may not be leakproof) could become a sequential scan. `EXPLAIN` the `/u/[username]` query. If it scans, use a `get_public_profile(p_username)` RPC.
- **Return to the requested page (#35, PR #41):**
  - **How `?next=` flows:** the proxy sends signed-out visitors to `/login?next=<path+query>`. It drops `next` when it is bare `/today`, longer than 512 characters, or anything `safeNextPath` would reject or rewrite.
  - **Where it is checked:** `safeNextPath` checks `next` again at every use: on the client after code sign-in, in `/auth/callback` after Google sign-in, and in the proxy when an already-signed-in user opens `/login?next=`.
  - **Code and Google sign-in only.** The `/auth/confirm` email link still ignores `next`, and that stays the case (see round 3 above).
  - **New users lose `next`.** Onboarding still ends on `/today`. Revisit this in Phase 7 if share links (`/u/<name>`) bring in sign-ups.
  - **The redirect allowlist entry is now `…/auth/callback**`.** GoTrue matches globs, so the `?next=` query needs it. Every match is still same-origin, and PKCE makes a code useless anywhere else. Production needs the same change in the dashboard (RUNBOOK).
  - **`safeNextPath` lives in `lib/validation/path.ts`,** which has no zod import, to keep zod out of the proxy bundle. `profile.ts` re-exports it.

## Phase 3

- **`e2e` is a required check on `main` (#42).** The Playwright job has run on every PR since Phase 2. Phase 3 makes it required alongside `ci` and `db-tests`, as plan §11.1 step 7 says.
- **CI quirks.** The workflow's `pull_request` trigger uses the default event types (`opened`, `synchronize`, `reopened`). So:
  - marking a PR ready for review doesn't start a run;
  - `gh pr update-branch` sometimes doesn't start one either.

  Close and reopen the PR to trigger CI. Don't push an empty commit: under rebase-merge it would land on `main`.

- **TanStack Query is deferred.** Plan §3 lists it for client data fetching. Phase 3 uses Server Components, Server Actions and `useOptimistic` instead: every habit write already goes through the server, and nothing yet needs a client cache. Revisit if the feed (Phase 7) needs infinite queries or background refetching.
- **Suggestion engine (plan §8.2):**
  - **Which habits count.** Only the "not already added" hard filter (rule 4) counts archived habits, so a habit the user archived isn't suggested again. Rules 1–3 (pairs, category gaps, time-slot gaps) and the coaching hints count **active** habits only.
  - **Duplicates (rule 4).** Titles are NFKC-normalised, lowercased, trimmed and have internal whitespace collapsed. They're duplicates when `1 − levenshtein(a, b) / max(len(a), len(b))` is above 0.8, with lengths and distance counted in code points after NFKC.
  - **Time slots (rule 3).** Slots are half-open intervals in the user's timezone, using the plan's names: morning [05:00, 11:00), midday [11:00, 17:00), evening [17:00, 23:00). Times from 23:00 to 05:00 fall in no slot.
    - A user habit fills every slot touched by any of its `reminder_times`, whether or not reminders are enabled. A template fills a gap if any of its `defaultTimes` falls in that slot.
    - A habit with no times (e.g. "Take medication") never fills a user's slot, and a template with no times is never suggested for a slot gap.
  - **Scoring.** Each rule contributes **at most once per template**. A template that fills two empty slots still gets +15, and one paired by two of the user's habits still gets +40. Scores from different rules add up.
  - **Ordering.** Suggestions are sorted by score, highest first. Ties are broken by category in this order: health, mind, fitness, self_care, nutrition, learning, career, finance, social. That's the plan's rule-2 priority, extended here to a global tie-break, then §8.1 table order (`other` has no templates). Remaining ties keep `templates.ts` declaration order.
  - **The "first week" coaching hint** is measured from `profiles.onboarded_at`, not from account creation.
  - **Implementation (#45).** `lib/habits/templates.ts` and `lib/habits/suggestions.ts`.
    - Suggestions are only templates with a **positive score**; the template library lists the rest.
    - Rule 1 pairs are **one-directional** (Workout → Stretch, not back). "The user has X" means a habit with X's key **or** a title that fuzzily matches X's, the same test rule 4 uses, so hand-typed habits get pairings too. Rule 5 (social proof) takes an optional `popularKeys` set, empty until Phase 7.
    - Habit-count hints count **the new habit too**: "more than 5" fires when the user already has 5 active habits. The first week ends exactly 7 days after `onboarded_at`; a user who hasn't onboarded counts as in it. Above 8 the stronger warning replaces the first-week one, and at 20 an `at_cap` hint replaces both. Count hints are skipped when editing.
    - Vague title: 1–2 words of cleaned text with a letter and no numeric character (`\p{N}`, which also covers times). Library template titles are exempt ("Floss" and "Workout" are fine as picked), and the hint uses the plan's generic example rather than splicing in the user's words.
    - Reminder collisions use the nearest existing reminder within ±10 min, wrapping at midnight. The `stack` hint carries the plan's "After I …, I will …" copy.
    - Template icons are single-code-point emoji with no variation selector or ZWJ, so the source has no invisible characters. Medication has no default time, so its reminders start off.
- **Onboarding step 2** lets the user pick **up to** 3 starter habits, and can be skipped. The original plan (`QUESTRIX_BUILD_PLAN.md`) §9 said "pick 3".
- **Schedules.** `lib/habits/schedule.ts` is for display only (Today ordering, "not today" labels). JS (browser or Node) ICU and Postgres tzdata can disagree, so SQL is authoritative for "is it scheduled today". That is owned by the Phase 4 `get_today` / `complete_habit` functions. Nothing in Phase 3 awards points from `schedule.ts`.
- **Habit input schemas (#44)** live in `lib/validation/habit.ts`. They mirror the habits CHECKs and trigger for early form errors; the database stays authoritative.
  - **Typed objects, not FormData.** Habit actions (#46) receive plain objects with numbers, booleans and arrays, so the schemas don't coerce. A form that posts FormData must convert it explicitly first. Never use `z.coerce.boolean()`, which turns `"false"` into `true`.
  - **Callers send the parsed output.** The schemas sort and de-duplicate days and reminder times. The trigger rejects oversized arrays before de-duplicating, so raw input could fail there.
  - **Reminder times** accept `HH:MM`, optionally with seconds (PostgREST returns `07:30:00`), and output `HH:MM`, as the trigger truncates to the minute.
  - **Updates can't change `template_key`,** although the column grant allows it: it records where a habit came from.
  - **Parity** between `cleanHabitText` and `habits_clean_text` is pinned on both sides: unit tests in JS and pgTAP vectors in SQL, because `\s` depends on the database's ctype. pgTAP runs on the local and CI image only, so the RUNBOOK has a one-off check on the hosted project after the first `db push`.
- **Habit queries and actions (#46).**
  - **Where they live.** `lib/habits/queries.ts` (`server-only`, `cache`d per request) and `lib/habits/actions.ts` (`"use server"` plus `server-only`), so the habits page and onboarding step 2 share them. Both get the user from `getVerifiedUser()` in `lib/supabase/session.ts`, which uses `getClaims`.
  - **Results, not throws.** Actions return `{ ok: true, data } | { ok: false, code, error, field? }`. `code` is one of `invalid`, `signed_out`, `not_found`, `at_cap`, `rate_limited`, `stale` and `failed`, so the UI can react without parsing text. Action errors are mapped by code; raw SQL messages are never returned, except the trigger's own `QX001` rate-limit message and hint, which we wrote for users. The cap is told apart from other `23514` errors by its message text, which pgTAP pins; a comment in `actions.ts` ties the two. Query errors throw with the PostgREST message, which only shows in dev, because Next redacts Server Component errors in production.
  - **Not found is one answer.** A malformed id, another user's habit (hidden by RLS) and `P0002` all return `not_found`, so ids can't be probed.
  - **Updates are scoped twice:** RLS plus an explicit `user_id` filter. Zero updated rows means `not_found`.
  - **`template_key` must be a library key.** `createHabit` rejects unknown keys, so the app's own writes are clean. The column grant still lets a direct API insert store any well-formed slug, so **Phase 7's social-proof counts must filter to library keys**. The value stays untrusted (never proof of anything).
  - **Starter habits** (`addStarterHabits`) take template keys only: at most 3, unique, all known. Every field comes from the library through `templateToHabit` and `habitCreateSchema`. One multi-row insert, so the cap and rate limits apply to all or none. An empty list (Skip) doesn't touch the database.
  - **Archived list cap.** Habits are never deleted, so `listArchivedHabits` returns the 200 most recently archived. The suggestion engine's "already added" filter (rule 4) sees those plus every active habit. A template archived longer ago than that may be suggested again, which is acceptable.
  - **Revalidation.** Every successful write calls `revalidatePath` for `/habits` and `/today`.
- **`template_key`** is used for analytics and suggestion matching only: rule 1 identifies the user's habit X by it, and rule 4 filters on it. It is never trusted as proof of anything (no points, no verification).
- **Ordering risk.** The routing extraction (#39, merged) had to land before onboarding step 2 (#48). That's now satisfied.
- **Reminder times are independent of `target_per_day` (decided in #43).** Reminders are notifications, not occurrences. A habit with `target_per_day = 3` can have one reminder or none, and "Drink 2 L of water" can have 4 reminders with a target of 4. Coupling the two would block common setups and buy nothing, because completions (Phase 4) are capped by `target_per_day` alone.
- **Habits schema (#43):**
  - **Colours** are the five accent tokens: `cyan`, `violet`, `magenta`, `success` and `warning`. They're stored by name, never as hex, so a theme change carries over.
  - **Normalisation happens in the BEFORE trigger,** so two clients can't store the same thing two ways. The trigger:
    - runs titles, descriptions and icons through `habits_clean_text`. It strips characters that render as nothing or reorder text (soft hyphen, the Arabic letter mark, the zero-width space, LRM/RLM, bidi embeddings, overrides and isolates U+2066–2069, the Hangul filler and the BOM), then trims all whitespace, including no-break spaces. ZWNJ and ZWJ (U+200C/200D) are only trimmed at the ends, because they join emoji (e.g. the woman-meditating emoji) and Persian and Indic text. Out of scope on purpose: astral tag characters, musical-notation format characters and other rare fillers. The function builds its character class with `chr()`, so the migration source stays ASCII and reviewable;
    - stores a blank `description` or `icon` as null;
    - sorts and de-duplicates `days_of_week`;
    - truncates `reminder_times` to the minute, then sorts and de-duplicates them.

    Before normalising, it rejects input that can't be normalised safely: nested arrays (`unnest` would flatten them), oversized arrays, and `24:00` (it would wrap to `00:00`). A null list is left null, so NOT NULL still reports it. CHECKs then reject the rest: empty or out-of-range days, nulls, more than 5 times, blank titles or titles with control characters, and lengths.

  - **`template_key`** must be a lowercase slug (`^[a-z0-9_]{1,40}$`), so the column can't hold free text.
  - **One per-user lock.** `habits_lock(uid)` is a transaction advisory lock on `hashtextextended('qx.habits.<uid>')`. Every write that depends on the user's set of habits takes it first: insert, archive, unarchive and reorder. Counts and positions are therefore computed against a stable set. It relies on READ COMMITTED, which PostgREST uses: a later caller running under REPEATABLE READ would see a stale count.
  - **The 20-active cap** is enforced in the trigger on insert and on unarchive. A multi-row insert that crosses it is rejected as a whole. pgTAP runs in one transaction, so it can't exercise concurrency. It was checked by hand with two sessions: the second blocked until the first committed, then failed, leaving 20 active habits with distinct positions.
  - **Creation limits.** Rolling windows bound archive-and-recreate churn without locking anyone out for good. A lifetime total was rejected for that reason: habits can't be deleted.
    - At most 30 habits created per 24 hours.
    - At most 100 habits created per 30 days.

    Both are checked in the insert branch of the trigger, under the lock. They raise `QX001` with a hint, so the UI can tell a rate limit apart from invalid input (`23514`). They should move to `economy_config` when Phase 4 adds it.

  - **`sort_order` is owned entirely by the server.** This deviates from plan §5.2, which granted it to clients on both insert and update.
    - New and unarchived habits go to the end of the active list.
    - The only way to reorder is `reorder_habits(p_habit_ids uuid[])`, which was added beyond plan §6.4. It must list every active habit exactly once (at most 20, flat), and it writes 0-based positions in one statement.
    - `sort_order` is bounded 0..10000 as a backstop.
    - List queries order by `sort_order, created_at, id`.
    - The generated `Insert` type still lists `sort_order`, because generated types ignore column grants. Phase 3 client code inserts through a Zod schema that omits it, and avoids PostgREST upserts, which need UPDATE on every column in the payload.
  - **`archive_habit` and `unarchive_habit` are idempotent.** They raise `P0002 Habit not found` for a habit that isn't yours, so another user's habit ids can't be probed.
  - **Indexes.** Plan §5.2 had only `(user_id) where archived_at is null`. This uses:
    - `(user_id, sort_order) where archived_at is null`, for the active list and `get_today` ordering;
    - a full `(user_id)` index, for the archived list and the FK cascade.

    `unique (id, user_id)` exists so Phase 4 completions can reference `(habit_id, user_id)`.
- **Phase 4 requirements created by the habits table** (from the #43 security audit and code review; Phase 4 must satisfy them):
  - **Snapshot before schedule edits.** Clients can edit `days_of_week` or archive habits directly, so a user who skipped day D could remove D's weekday before D is snapshotted, turning a miss into a rest day. Any INSERT, `days_of_week` change, archive or unarchive must first call `ensure_daily_schedule(user, local_today)`. That call also fills missing past days, up to 7. Edits then only affect days not yet snapshotted.
  - **Archive-and-recreate must not farm points.** The 20-active cap is not a points ceiling: complete a habit, archive it, create a new one, complete that. The creation limits above bound this, but `complete_habit` must also refuse habits created after that day's `daily_schedule` snapshot, or there must be a daily cap on completion points.
  - **Read the habit under lock.** `complete_habit` reads `target_per_day`, `difficulty` and `archived_at` under a row lock (`for share`, after the profile lock), never from client-cached values.
  - **Mid-day edits.** `difficulty` and `target_per_day` can be edited mid-day. Either snapshot them into that day's `daily_schedule` with `days_of_week`, or cap daily completion points.
  - **Lock order.** Take the profile lock, then `habits_lock`, then row locks. The trigger will call `ensure_daily_schedule`, which likely takes the profile lock while `habits_lock` is held, so `complete_habit` must not take them in the opposite order.
  - **`UPDATE OF` triggers.** `habits_before_write` doesn't fire for columns changed by another BEFORE trigger. A future trigger that sets `archived_at` would skip the cap.
  - **Completion ownership.** Completions use a composite FK `(habit_id, user_id) references habits (id, user_id)`.
  - **Weekday type.** Compare weekdays with `extract(dow from d)::smallint = any (days_of_week)`, because `extract` returns numeric.
  - **Phase 5:** `due_reminders` needs a partial index on active habits with reminders, and must handle local times that don't exist or happen twice on DST days.
