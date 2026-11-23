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
- **Habits UI (#47).**
  - **Reorder is move up/down buttons, not drag.** Plan §9 says drag-to-reorder. Buttons work the same with touch, keyboard and screen readers, and need no drag library. Drag can be added on top later.
    - A move is optimistic (`useOptimistic`) and sends the full order to `reorderHabits`.
    - It is announced in a polite live region, and focus stays on the moved habit (or its other button once the first is disabled).
    - A refused move rolls back and says so. A `stale` refusal also calls `router.refresh()`.
  - **Focus never falls to the page.** After an archive, focus moves to the next habit's link, else the previous one, else Add. After a restore, it moves to the restored habit once the server list arrives.
  - **Archive is optimistic; restore isn't.** While a restore is pending, the other Restore buttons are unavailable.
  - **Unavailable controls use `aria-disabled`, not `disabled`.** This covers Add, Restore and the form's Add habit at 20 active habits. They stay focusable, their click does nothing, and `aria-describedby` points at the reason (ids from `useId`). Native `disabled` is kept for transient states such as "Saving…".
  - **Add/Edit share `HabitForm`.** Create mode shows up to 6 suggestions plus the full library in a `<details>`. Picking one fills every field, records `template_key`, announces it, and moves focus to Name.
    - **`template_key` stays after edits.** It records where the habit came from.
    - **The selected template is marked with a sr-only ", selected"**, not `aria-pressed`: pressing it again doesn't untoggle it.
  - **Coaching hints.** They are recomputed on every change; `now` comes from the server so both renders agree. The visible hints aren't a live region. A separate, always-present sr-only status region announces a hint only when its kind first appears, so typing a title doesn't re-announce text that embeds it.
  - **Errors.** A server field error is shown next to its field (`aria-invalid`, `aria-describedby`, on the fieldset for days and reminders) and focused. For days that's the first day button; for reminders it's the first time, or "Add a reminder time". Errors for fields without an inline slot show in the form-level alert.
  - **Layout at 320 px.** The days are a 7-column grid (each button about 37 × 44 px) and the colours wrap, so nothing overflows.
  - **Client bundle.** Client components import limits and colours from `lib/habits/limits.ts` and labels and types from `lib/habits/display.ts`, neither of which imports zod. `lib/validation/habit.ts` re-exports the limits. The list page sends only the fields the list renders.
  - **Edit** is `/habits/[id]/edit`. Its `params` are read inside Suspense (runtime data under `cacheComponents`). So an unknown or malformed id renders the not-found UI with **HTTP 200 and `noindex`**, not a 404 status: the shell has already streamed.
- **Onboarding step 2 (#48)** is `/onboarding/habits`. Step 1 now redirects there instead of to `/today`.
  - **Gating.** Step 1 sets `onboarded_at`, so the proxy lets the user through, and a user who hasn't finished step 1 is sent back to `/onboarding`. Step 2 is optional, so it isn't enforced: a user who leaves can always add habits from `/habits`. Revisiting it later is harmless, because it uses the normal create path with its cap and rate limits.
  - **What it shows.** The engine's top 6 suggestions, which for a new user means the plan's priority order (health, mind, fitness), then every other template by category under "More habits". It is a checklist of up to 3. Once 3 are picked, the rest are `aria-disabled` and point at the live "3 of 3 picked" count. "Skip for now" goes to Today.
  - **Server-side.** Only template keys go to `addStarterHabits` (#46), which builds every field itself.
  - **Review fixes (round 1).**
    - The page checks `onboarded_at` itself, in case the proxy's lookup failed.
    - Templates the user already has aren't offered again.
    - Add is `aria-disabled` while nothing is picked.
    - A thrown action shows an error and keeps Skip available.
    - Each checkbox is named by its title, with the category as its description.
    - Picks and Skip are inert while the request is in flight.
    - After adding, the client still navigates with `router.push`, because `addStarterHabits` is shared with `/habits`. Phase 5's step 3 will change where it goes.
  - **Step numbering.** The page says "Step 2" without a total, because Phase 5 adds the notifications step.
- **Phase 3 acceptance E2E (#49).** `tests/e2e/habit-template.spec.ts` runs on the `iphone-13` project only (`testIgnore` on desktop). The habit flow uses taps.
  - **What it checks.** "Meditate 10 min" is suggested to a new user. The test picks it from the full library and checks every field the template fills: name, icon, category, difficulty, days, target, "Remind me" and the time. It then checks that nothing overflows the viewport, that the habit survives a reload, and that rule 4 drops it from the suggestions, waiting for the suggestions to load first.
  - **Exact label matching.** Next 16 with `cacheComponents` keeps previously visited routes mounted but hidden, and `getByLabel` matches substrings ("Name" in "Username", "Reminder time 1" in "Remove reminder time 1"). So E2E label lookups use `exact: true`.
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

    Both are checked in the insert branch of the trigger, under the lock. They raise `QX001` with a hint, so the UI can tell a rate limit apart from invalid input (`23514`). They moved to `economy_config` in #67.

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
  - **Snapshot before schedule edits.** Clients can edit `days_of_week` or archive habits directly, so a user who skipped day D could remove D's weekday before D is snapshotted, turning a miss into a rest day. Done in #67: see "Daily schedule (#67)" under Phase 4.
  - **Archive-and-recreate must not farm points.** The 20-active cap is not a points ceiling: complete a habit, archive it, create a new one, complete that. The creation limits above bound this, but `complete_habit` must also refuse habits created after that day's `daily_schedule` snapshot, or there must be a daily cap on completion points.
  - **Read the habit under lock.** `complete_habit` reads `target_per_day`, `difficulty` and `archived_at` under a row lock (`for share`, after the profile lock), never from client-cached values.
  - **Mid-day edits.** `difficulty` and `target_per_day` can be edited mid-day. Either snapshot them into that day's `daily_schedule` with `days_of_week`, or cap daily completion points.
  - **Lock order.** Superseded by DECISIONS § Phase 4, D5: `ensure_daily_schedule` takes no profile lock, so the habits trigger never takes it either.
  - **`UPDATE OF` triggers.** `habits_before_write` doesn't fire for columns changed by another BEFORE trigger. A future trigger that sets `archived_at` would skip the cap.
  - **Completion ownership.** Completions use a composite FK `(habit_id, user_id) references habits (id, user_id)`.
  - **Weekday type.** Compare weekdays with `extract(dow from d)::smallint = any (days_of_week)`, because `extract` returns numeric.
  - **Phase 5:** `due_reminders` needs a partial index on active habits with reminders, and must handle local times that don't exist or happen twice on DST days.

## Phase 4

Pinned before coding, from the planner (#65). Each task records refinements below its own heading.

- **D1. Per-habit schedule snapshot.** Plan §5.2 had `daily_schedule(user_id, local_date, scheduled_count)`. Phase 4 adds a child table, `daily_schedule_habits(user_id, local_date, habit_id, difficulty, target_per_day)`.
  - **When a habit enters a day's snapshot:** when the day is first snapshotted, and again when the habit is inserted or unarchived, or has that day added to `days_of_week`. For an insert this happens in an AFTER INSERT trigger, because the foreign key needs the habit row to exist.
  - **Never removed.** Archiving or editing a habit doesn't remove it, so `scheduled_count` never falls. A day holds at most 20 habits, which bounds archive-and-recreate farming.
  - **What reads the snapshot.** Points, targets and "scheduled today" all come from the snapshot, never the live habit. Changes to `difficulty` and `target_per_day` therefore apply from the next day.
  - **Enforced by the database.** `habit_completions` has a foreign key to the snapshot, so a completion of an unscheduled habit can't exist.
  - **Late joiners don't count the day (#82, security audit of PR #80, M2).** `daily_schedule_habits.initial` marks the habits in a day's first snapshot. Only `ensure_daily_schedule` writes true; the column defaults to false, so a new insert path fails closed. Rows that existed before the column are treated as initial.
    - The exploit: keep every habit archived, so each day's snapshot is empty and counts as a rest day. Then unarchive one habit on the days you choose, complete it to grow the streak, and archive it again. Skipped days never broke the streak.
    - Now a completion of a late-joined habit earns points, but takes the "no change" path for the global streak and leaves the day uncounted. A later completion of an initial habit still counts the day.
    - Its multiplier and reported streak are the streak as judged today, the value `get_today` shows. They don't include the day it would have added, and a lost streak pays the base rate.
    - **No live streak, no restriction.** When the streak as judged today is 0 (no streak yet, or lost to misses or the lookback), a late joiner counts the day as usual: it can only start a run at 1, so there's nothing to farm. This matters for every new user. Onboarding sets `onboarded_at` before step 2 adds habits, so the first habit insert snapshots an empty day and every first-day habit joins late. Without this rule the first day could never count. The review of PR #94 found this, and the e2e check caught it. `public.streak_as_of` holds the judgement, shared with relived days (#81).
    - **Trade-off, accepted:** with a live streak, a habit created mid-day only counts from the next day. `get_today` reports `joined_late` per habit. While it matters (a live streak, today not counted yet, not relived), the Today card says "Not for today's streak". A list holding only late habits gets the archived-day banner, which offers restoring, not adding, and the freeze hint is hidden.
    - **Undo on a rule-0 day.** After a move west onto an already-counted day, undoing the day's last initial completion while late ones remain now raises `QX108`, where before it went through as a no-op. That fails closed and is accepted.
    - **Undo.** Undoing the day's last completion of an initial habit restores its streak state, even if late joiners' completions remain. Before, only an emptied day was restored, so the streak and a milestone could rest on a late completion (found by `test-writer`).
    - **Planning a day ahead still works, and that's accepted.** Unarchiving a habit the evening before puts it in the next day's first snapshot. That's the same as editing `days_of_week` ahead of time, which users may do (D1: edits only affect days not yet snapshotted). The exploit closed here is choosing on the day itself, after the day has already started as a rest day.
    - Per-habit streaks still advance for late joiners. They carry no points, freezes or milestones, and undo's QX108 guard depends on them advancing (see #85).
- **D2. Lazy backfill instead of the nightly job.** Plan §5.2 and §6.2 call for a nightly pg_cron job to fill `daily_schedule`. Instead, `ensure_daily_schedule` fills missing days on demand. This deviation drops the job.
  - Up to 7 past days are filled, rebuilt from `created_at`/`archived_at` and the current `days_of_week`. That's accurate because every edit to the days snapshots first.
  - Never earlier than the onboarding date.
  - A day still missing counts as not a rest day (fail closed, as in the plan).
  - pg_cron stays out of the stack until Phase 5 reminders.
- **D3. Timezone changes (#28).**
  - After onboarding, the timezone can change once per `timezone_change_cooldown_days` (7), tracked in `profiles.timezone_changed_at`. A change inside the cooldown raises `QX001` with a hint. Onboarding is exempt while `onboarded_at` is null.
  - The old timezone's day is snapshotted before the change.
  - **Moving east.** The new timezone's days up to its today are the same real day as the old today. If nothing was required there, `last_streak_date` moves to the new local date. "Nothing required" means today in the old zone was already counted, or every day since the last counted one was a rest day.
    - A cooldown alone wouldn't be enough: with a single change, a user could complete at UTC-12, switch to UTC+14 and complete "tomorrow" minutes later. The rest-day case was a hole found in review (#67).
    - With this rule no streak is gained, and extra points are bounded to one day per cooldown.
    - If a scheduled day is still pending in the old zone, it stays pending and becomes a missed day (fail closed). Users should complete before switching.
    - A streak older than the lookback isn't revived.
    - Per-habit streaks follow the same rule, each on its own schedule. A habit inherits if it was counted today, or if it wasn't in any day's snapshot since its last count. A missing day fails closed.
    - Inheriting restarts the lookback clock, so an all-rest stretch can outlast `streak_lookback_days` across a jump; accepted. Shifting the date instead would make the new timezone's days fail closed as misses.
    - A jump of up to two days (UTC-12 late evening to UTC+14) bridges the skipped day without a completion; accepted.
    - #28's end-to-end acceptance (two streak increments within 24 real hours) needs `complete_habit`, so #28 closes in #68.
  - **Moving west.** A day that was already counted is covered by plan §6.2 rule 0. The user can still collect points for its unused occurrences, bounded to one day per cooldown.
    - The original claim, that rule 0 covers every move west, was wrong (#81, security audit of PR #80, M1). A user who missed D-1 could move west early on D, complete D-1 as an increment with nothing missed, and so get a free freeze once per cooldown.
    - **Relived days (#81).** On a westward change, `profiles_validate` sets `profiles.engine_floor_date` to the old today, under the profile row lock. Clients can read the column but can't write it. A first completion on a date before the floor and after `last_streak_date` (or with no streak yet) is on a relived day. It earns points, but the streak, freezes, run and milestones don't change, and the day stays uncounted, so it's still a miss when the floor day comes. Undo of such a completion only gives back the points.
    - A relived day pays the base multiplier (streak 1). The stored streak may already be lost as of the floor day, so paying it would reward the move (found by `test-writer`). The completion reports the streak as judged on the floor day, the same value `get_today` shows.
    - The first draft read "reached" from `max(daily_schedule.local_date)` instead of a column. That raced (review of PR #84, B1): `get_today` and the habits trigger commit snapshots without the engine's profile lock. A completion started just before midnight could wait behind tomorrow's snapshot and be wrongly treated as relived, breaking an honest streak. Only a timezone change writes the floor, so that can't happen.
    - `get_today` adds `relived`: the streak is judged as of the floor day, `freezes_needed` is 0, and the day is never `at_risk`. The Today screen explains the day.
    - Per-habit streaks are unchanged on relived days: they carry no points, freezes or milestones. They can bridge a missed day through a relived one; revisit this if they ever feed rewards (#85).
- **D4. `economy_config`** is `key text PK, value jsonb`. It's read through the internal `economy_value(key)`, which raises if the key is missing. Signed-in users can read the table, but nobody can write it from a client. ECONOMY.md documents every key.
- **D5. Lock order.**
  - `complete_habit` and, later, `purchase_item` lock the profile row `for no key update`, then call `ensure_daily_schedule`, then lock the habit row `for share` (see below). `undo_completion` locks the profile, then the completion row `for update`, and nothing else (see #69).
    - They must not lock the `daily_schedule` row at SHARE or above before the habit row. A habit edit holds the habit row, then waits on the day row in `snapshot_add_habit`. Read the day row unlocked: apart from append-only snapshot entries, it doesn't change.
    - Plan §6 says `for update`. That would deadlock: inserting a `daily_schedule` row checks its foreign key by taking `FOR KEY SHARE` on `profiles`, which conflicts with `FOR UPDATE`.
    - `FOR NO KEY UPDATE` still serialises engine calls against each other and against client profile updates, but it doesn't block foreign-key checks.
  - `ensure_daily_schedule` takes no explicit profile lock. It inserts with `on conflict do nothing`, keyed by the primary key.
  - The habits trigger and RPCs take the habit row or `habits_lock` before calling it.
  - **Only single-row paths call `ensure_daily_schedule`.** That means insert, unarchive, archive and a `days_of_week` change. `reorder_habits` never calls it, because order doesn't affect schedules. A multi-row statement that called it after locking one habit row could wait on another row that `complete_habit` holds `for share`, while `complete_habit` waits on the uncommitted `daily_schedule` row.
  - **Username changes take `FOR UPDATE`.** Any profile UPDATE that sets the unique `username` takes `FOR UPDATE`, which blocks foreign-key checks; onboarding sets `username` and `timezone` together. So the timezone snapshot (D3) is skipped while `onboarded_at` is null.
  - **`get_today` (#70) reads the profile `FOR SHARE`,** then calls `ensure_daily_schedule`. It takes the profile first while holding nothing, and its later locks never conflict with the paths above. Its only conflicts are with the engine's `FOR NO KEY UPDATE` and with profile updates, so it can only wait, never deadlock.
  - **Deadlocks are retryable.** The app's actions map a `40P01` deadlock to "Try again", in `lib/supabase/errors.ts`.
  - **`complete_habit` snapshots before locking the habit row.** The order is profile, then `ensure_daily_schedule`, then habit `for share`. `ensure` only takes `KEY SHARE` on habit rows, which never conflicts, so it never waits while holding a habit lock that a habit UPDATE needs.
  - **Multi-row client updates.** A client can still send a multi-row `UPDATE habits` (RLS limits it to its own rows). That can deadlock with its own `complete_habit`. It's self-only and retryable, so it's accepted.
    - The same goes for a direct single-row archive (row lock, then `habits_lock`) racing that user's own reorder (`habits_lock` first).
  - **Username and timezone together.** After onboarding, changing both in one statement is refused (`QX002`, distinct from onboarding's "unknown timezone" `22023`). The username change would take `FOR UPDATE` on the profile while the snapshot waits on a concurrent day row.
  - The #67 and #68 PRs record two-session checks: a habit edit against `complete_habit`, and reorder against the first `complete_habit` of a day.
  - This replaces the Phase 3 note, which would also have deadlocked: a client UPDATE locks the habit row before its BEFORE trigger runs.
- **D6. Time seam for tests.** Internal `complete_habit_at(uid, habit, now)` and `undo_completion_at(...)` take the time as a parameter, and EXECUTE is revoked from every client role. The public RPCs are thin wrappers that use `auth.uid()` and `now()`. pgTAP runs in one transaction, so it needs the seam to simulate days.
- **D7. `get_today`** returns JSON with only today's scheduled habits.
  - `at_risk` is computed on the server: today is scheduled, nothing is done yet, and the local time is 18:00 or later. #70 also requires a live streak, and today not already counted (eastward inheritance counts it). With no streak there's nothing at risk, and a "streak at risk" banner on streak 0 would be wrong.
  - `level` is computed in SQL, and a parity test keeps it equal to `lib/points/levels.ts`.
  - It writes, through `ensure_daily_schedule`, so it's VOLATILE.
  - **Implemented in #70** as `get_today()`, plus the time seam `get_today_at(uid, now)`. Its codes are `28000`, `P0002` and `QX107` (onboarding not finished). The JSON is documented in BUILD_PLAN §6.4.
    - **The streak is reported as it stands now.** The stored `current_streak` changes only on the next completion, so after missed days it would overstate. `get_today` applies the same rules as `complete_habit_at` (lookback, `streak_missed_days`, freezes) and reports 0 for a streak the next completion would reset. `freezes_needed` gives the freezes that completion would spend. Per-habit streaks use `habit_missed_days` and have no freezes.
    - **The habits are today's snapshot entries,** minus any habit archived since, in list order. They carry the snapshotted difficulty and target, plus today's completions (id, occurrence, points, `undoable_until`) for the undo UI.
    - **Review fixes (round 1).**
      - `undoable_until` stops at the end of the local day, because undo refuses an earlier day's completion (`QX105`). Where midnight happens twice (an Azores-style fall-back at 01:00), it uses the first 00:00, when the date changes (round 2).
      - The profile is read `FOR SHARE`, so one response sees one state: no engine call or timezone change commits mid-way. The lock conflicts only with the engine's `FOR NO KEY UPDATE` and with profile updates. It keeps the profile-first order (D5), and it allows the `FOR KEY SHARE` taken by `ensure_daily_schedule`'s inserts.
      - The `habit_streaks` and completion joins also filter on `user_id`, so scoping doesn't rely only on the composite FKs.
      - `P0002` also covers a missing `economy_config` key, which is a server bug and never a client case.
    - **Every habit scheduled today has since been archived.** `scheduled_count` stays fixed (D1), so the day is still required, and archived habits can't be completed (`QX102`). With a live streak after 18:00, `get_today` returns `at_risk = true` and `habits: []`. That's the anti-cheat rule working: archiving can't turn a required day into a rest day. Restoring one of them and completing it counts the day. A habit added mid-day joins today's snapshot late and doesn't count it while the streak is live (#82). **#71 requirement, revised in #82:** when `at_risk` is true and the list is empty (or holds only late habits), the banner offers to restore a habit, not to add one. In general `habits.length` can differ from `scheduled_count` in either direction: habits added mid-day are listed but not counted, and habits archived since are counted but not listed.
    - **Completed, then archived the same day.** The habit drops off the list, but its completions still count in `completed_count` and `counted_today`, because the day really was done. So the sum of `done` can be less than `completed_count`.
    - **Requirement for the Today screen (#71).** `complete_habit`'s `habit_streak` is the stored value when that completion doesn't reach the target. After missed days, that can be stale. Take streaks for display from `get_today` (refresh after each mutation), and use the completion's `habit_streak` only when it reached the target.
    - **Level parity.** `060_get_today.sql` and `lib/points/levels.test.ts` pin the same boundaries (level L starts at `50·(L−1)²`, for L up to 300) and the same fixture values.
  - **Engine invariants (#70).** `070_engine_invariants` runs a seeded 800-step random walk over four users. The steps are complete, immediate or later undo, an `admin_adjust` spend, skipping days, and stepping back up to 2 hours, which relives a day as a move west does. After every step it checks the ledger, streak, snapshot and milestone invariants listed in ECONOMY.md, and it asserts that every refusal was an expected engine code. A self-test corrupts a balance to show the checker catches it.
- **D8. Milestones.** Awarded on the day's first completion when `current_streak` reaches a configured value, once per `(user_id, streak_run_started, milestone)`. Revoking a milestone **deletes** its row and writes an `undo` ledger entry whose `ref_id` is the old milestone id. If the user completes again that day, the milestone is re-awarded with a fresh id, so the ledger's once-per-ref index never collides. `awarded_on` records the local day, so an undo that empties that day revokes the milestone. In Phase 4 there's no inbox notification: plan §6.2 wants one, but `notifications_inbox` arrives in Phase 7, so for now the milestone appears in the RPC's JSON and as confetti.
- **D9. Error codes.** Each refusal gets its own SQLSTATE (pinned in #68 and #69), so the UI maps codes, never message text. `P0002` covers both a missing habit and another user's habit.
- **D10. Concurrency.** pgTAP runs in one transaction, so it can't open two sessions. The unique occurrence constraint and the lock are tested structurally, and a real two-session check is recorded in the `complete_habit` PR, as in #43.
- **Spending before Phase 6.** pgTAP spends points through a postgres-only helper that writes an `admin_adjust` ledger entry. Phase 6 re-runs the invariant test with `purchase_item`.
- **Engine schema (#66).**
  - **Columns beyond plan §5.2:**
    - `habit_streaks.user_id`, so the owner-only policy can filter on it.
    - `streak_milestones_awarded` gains `id`, `points` and `awarded_on`, so its ledger entries can point at it and an undo knows what to revoke.
    - Undo needs `longest` as well, so it can restore exactly: `daily_progress.longest_streak_before` and `habit_completions.habit_longest_before`.
  - **Foreign keys.**
    - The composite keys tie every completion, snapshot entry and streak to the habit's owner. Those tables have no direct foreign key to `profiles`; they cascade through `habits`.
    - The completion → snapshot and snapshot → day keys are **not** cascades, so a stray delete of a day or snapshot entry fails instead of erasing completions.
    - They're a backstop: `complete_habit` checks snapshot membership itself and raises its own D9 code. A deferred FK only fails at commit, with a generic 23503 that can't be caught.
    - They're `deferrable initially deferred`, so the check runs at commit. Account deletion removes those rows through two cascades (profiles → days, and profiles → habits → snapshot), and Postgres fires cascades in trigger-name order, which isn't guaranteed. An immediate check could run before the snapshot rows are gone, depending on OIDs: a review reproduced the failure. pgTAP forces the check with `SET CONSTRAINTS ALL IMMEDIATE` after a deletion.
  - **Deleting a habit.** Clients can't delete habits. If `service_role` or account deletion does, the habit's completions, snapshot entries and streak go with it, and the day row and ledger stay. The balance therefore still equals the ledger sum. Accepted, and tested.
  - **Ledger.**
    - It's append-only even for `service_role`: no UPDATE, DELETE or TRUNCATE. The cascade from `profiles` still deletes, because foreign-key actions run as the table owner.
    - The sign follows the reason (CHECK).
    - `(reason, ref_id)` is unique for completion, milestone, undo and refund entries, so a retry can't book anything twice. Purchases aren't covered, because a consumable can be bought again with the same item.
    - Engine entries must carry a `ref_id` (CHECK), so a null can't slip past the index.
    - `ref_id` points at the completion, milestone or `user_items` row.
  - **Points formula.** A CHECK pins `points_awarded = floor(base_points × multiplier)`.
  - **Sequences.** Supabase's default privileges give `anon` and `authenticated` USAGE and UPDATE on new sequences. A client could then `setval` the ledger's id and break every later insert. The migration revokes that for the ledger sequence and for future sequences.
  - **Config and CHECKs.**
    - Two CHECKs still limit config values: `profiles.streak_freezes` (0..2) caps `streak_freezes_max`, and `multiplier` (at most 9.99) caps the multiplier. ECONOMY.md says so.
    - **Config values are validated** by `economy_config_value_valid` (a CHECK can't hold subqueries).
      - It checks shape, whole numbers where needed and a sane range per key, never returns null, and rejects unknown keys.
      - The ranges keep `1 + multiplier_step × multiplier_cap` at 9.9 or below, which fits `numeric(4,2)`.
      - `scheduled_count` keeps a hard ceiling of 50 in case the config is mis-set.
      - The config cap itself is owned by `ensure_daily_schedule`.
    - **Multiplier rounding.** The formula CHECK uses the stored `numeric(4,2)` multiplier, so the engine rounds the multiplier to 2 dp before computing points.
    - **`economy_value` is SECURITY INVOKER**, and no role can call it except the owner. So its callers must be SECURITY DEFINER functions owned by `postgres`. The habits trigger functions that read config in #67 must run as definer, or a direct `service_role` write would fail.
    - **Identity, not serial.** The default sequence privileges no longer reach clients, so a client-insertable table must use identity columns. Nothing is created as `supabase_admin`, whose default ACL still grants clients sequence access.
  - **Access.** Clients can only read their own rows, and the policies are written out per table. All writes happen in SECURITY DEFINER functions owned by `postgres`.
- **Daily schedule (#67).**
  - **`scheduled_count` is fixed at the first snapshot of a day.** D1 had it able to rise. A habit created, unarchived or given today's weekday later that day joins the snapshot, so it can be completed, but it doesn't raise the count. Creating a habit at 23:00 therefore can't turn a rest day into a missed day. The 20-entry cap still bounds farming.
  - **`ensure_daily_schedule(uid, now)`** claims each missing day with `insert … on conflict do nothing` before filling it. A concurrent snapshot of the same day waits on the primary key, then does nothing.
    - A past day's habits are those created by then, not archived before it, and scheduled on its weekday.
    - It records their current difficulty and target. That's accurate, because every edit to those snapshots first.
  - **The habits trigger** snapshots before an insert or a change to days, difficulty, target or archive. The `UPDATE OF` list gains `difficulty` and `target_per_day`.
    - On insert it takes `habits_lock` first, as `archive_habit` and `unarchive_habit` do; taking them in the other order could deadlock.
    - A new AFTER trigger adds the habit to today's snapshot.
    - The creation limits are read from `economy_config`.
  - **Timezone (#28).** `profiles_validate` enforces the cooldown (`QX001`, with a hint naming the date), snapshots the old timezone's days, applies the eastward rule, and stamps `timezone_changed_at`.
    - The onboarding exemption checks the _old_ `onboarded_at`, because step 1 sets the username, which stamps `onboarded_at`, and the timezone in one update.
    - Clients can read `timezone_changed_at` but not write it.
  - **Review fixes (round 1).**
    - `snapshot_add_habit` locks today's `daily_schedule` row `FOR NO KEY UPDATE` before counting, so concurrent additions can't pass the cap together.
    - The day loop steps in integers. `generate_series(date, date, interval)` runs in the session timezone and skipped a day where DST changes at midnight (Santiago).
    - There's a fast path when today is already snapshotted.
    - The creation limits are checked before the snapshot.
    - `habits_lock` is taken before the snapshot for any `archived_at` change, not only for inserts.
    - **After a move west**, the new window can reach a day or two further back than any earlier snapshot. Those days stay missing on purpose: only an edited schedule could fill them now, and a missing day counts as missed (fail closed, D2). **#68 must treat a missing `daily_schedule` row in the lookback as a missed day.**
    - The cooldown hint gives the local time in the user's old timezone ("on or after YYYY-MM-DD HH:MI (Zone)", rounded up to the minute).
    - A habit insert for a user with no profile now fails with `P0002 Profile not found` from the snapshot, before the FK check.
  - **Two-session check (D10), run against the local stack.** All three cases passed: the second session waited for the first, then committed. There was no deadlock, and each day was snapshotted once, with the pre-edit schedule.
    1. Two habit edits racing to take a day's first snapshot.
    2. `archive_habit` against a habit insert.
    3. A timezone change against a habit edit.
- **`complete_habit` (#68).**
  - **Codes (D9).**

    | Code    | Meaning                       |
    | ------- | ----------------------------- |
    | `QX101` | not scheduled today           |
    | `QX102` | archived                      |
    | `QX103` | target reached                |
    | `QX107` | onboarding not finished       |
    | `P0002` | habit not found, or not yours |
    | `28000` | not signed in                 |

    Undo's codes are listed under `undo_completion` (#69) below.

  - **Order.**
    1. Profile `for no key update`.
    2. `ensure_daily_schedule`.
    3. Habit `for share` (D5).
    4. Read the snapshot entry; this is the "scheduled today" check, and it supplies the difficulty and target.
    5. Take the lowest free occurrence.
    6. Run the streak rules (recording the day's before-state), then compute points, then write the completion, the habit streak, the ledger, `daily_progress`, any milestone and the profile.
  - **Accepted deadlock window.** A completion's first snapshot of a day can be uncommitted when a concurrent edit of the same habit takes its row lock; each then waits on the other. Postgres aborts one, and the actions show "Try again" (`40P01`). Taking the habit row first would reintroduce the multi-row cycle (D5). It needs the day's first engine call and an edit of that habit at the same moment.
  - **Streak rules (plan §6.2).**
    - The streak changes on the day's first completion, tracked by `daily_progress.counted_for_streak`, so an undo that empties the day lets the next completion count again.
    - Rules 0 and 1 share one branch: a day on or before `last_streak_date` changes nothing.
    - A gap longer than `streak_lookback_days` breaks the streak without spending freezes, even if every day in it was a rest day (for example, every habit archived for a holiday). Tests pin this. Changing it means changing the gap check before `streak_missed_days`, and the matching per-habit check.
    - A missing snapshot row is a missed day (D2), through `streak_missed_days`.
  - **Points.** The multiplier is rounded to 2 dp before `floor(base × multiplier)`, so the stored value reproduces the award (formula CHECK).
  - **Per-habit streak.**
    - It advances when the day's count first reaches the snapshotted target. A day in the habit's snapshot without that, or a missing day, is a miss (`habit_missed_days`). Days the habit wasn't scheduled are skipped.
    - Every completion of the day stores the same pre-day state, so undoing any of them restores it exactly. #69 enforces this after a move west too: when the streak advances, the day's completions are rewritten to the pre-advance state.
    - **Deviation from plan §6.2:** like the global streak, a per-habit gap longer than the lookback resets the habit's streak, even if the habit wasn't scheduled in between (for example, archived for over a week). Fail closed.
  - **Milestones** are awarded when the streak is set this call (first ever, increment, freeze or reset) to a configured value. Rules 0 and 1 never award. `on conflict do nothing` keeps them once per run, and the ledger `ref_id` is the milestone's id.
  - **`level_for(lifetime)`** is the SQL twin of `lib/points/levels.ts`. Clients can call it; #70 adds the parity test.
  - **Two-session checks, run against the local stack.** All three passed, with no deadlock.
    1. Two simultaneous completions of a target-2 habit got occurrences 1 and 2, and the balance equalled the ledger.
    2. `complete_habit` against a habit edit at the day's first call: the award used the pre-edit (snapshotted) difficulty.
    3. `complete_habit` against `reorder_habits`.
  - **#28** is closed by the end-to-end flip test: complete at UTC-12, switch to UTC+14, complete "tomorrow". The streak stays at 1.
  - **Review fixes (round 1).**
    - The function-wide `unique_violation` handler is gone. The occurrence insert uses `on conflict on constraint habit_completions_occurrence_unique do nothing` and raises `QX103`, so other unique errors surface.
    - The milestone check uses an explicit "streak set" flag.
    - `streak_missed_days` and `habit_missed_days` are SECURITY INVOKER.
    - A missing run date is defended with `coalesce`.
    - A missing profile says "Profile not found".
    - **The `QX103` backstop** (`on conflict` on the occurrence constraint) is unreachable from one session, because the profile lock serialises a user's calls. It's intentionally untested in pgTAP, which runs one transaction. The two-session check above (simultaneous completions got occurrences 1 and 2) covers the concurrent path. #70 pins "Profile not found".
  - **Requirements for `undo_completion` (#69), from the security audit (M1).**
    - Restore the profile's streak state only when the completion's day is the profile's `last_streak_date` and it's the last remaining completion of that day. Earlier days' before-states are stale once a later day has counted: undoing D then D+1 across midnight would otherwise leave a streak with no completion on D.
    - The same rule applies to `habit_streaks` (`local_date = last_date`).
    - A null `habit_current_before` means no streak row existed before, so delete the row.
    - Emptying a day sets `counted_for_streak = false`, so the next completion records the restored state. A test pins this overwrite path.
- **`undo_completion` (#69).**
  - **Codes (D9),** in addition to `complete_habit`'s:

    | Code    | Meaning                                                    |
    | ------- | ---------------------------------------------------------- |
    | `P0002` | completion not found, not yours, or already undone         |
    | `QX104` | the undo window (`undo_window_minutes`) has passed         |
    | `QX105` | not from the user's current local day                      |
    | `QX106` | the balance can't cover the points plus any milestone      |
    | `QX108` | a later day already counts on this one (after a move west) |

  - **Order.** The profile `for no key update`, then the completion `for update`. There's no `ensure_daily_schedule` and no habit lock, a deviation from D5's original list. Undo only reads its snapshot entry (unlocked, D5) for the target, and habit edits never touch completions, `habit_streaks` or `daily_progress`, so there's nothing to order against. The completion row lock only meets a cascade from deleting the habit or profile. A profile delete takes the profile row first. A `service_role` habit delete has no profile lock: its cascade can hold the `habit_streaks` row or later completions that undo then waits on, while it waits on the completion undo holds. Postgres detects that cycle (`40P01`, retryable), and it needs a `service_role` delete racing the user's own undo, so it's accepted.
  - **The checks run in this order:** ownership (`P0002`), the day (`QX105`), the window (`QX104`, inclusive at exactly 15 minutes), then a later day built on this one (`QX108`), then the balance (`QX106`). The day is checked first, so a completion at 23:55 undone at 00:05 says "not today".
  - **M1.** Profile streak state is restored when the undo empties a counted day. `habit_streaks` are restored when the day drops below its target. A null before-state deletes the streak row.
    - **Only the latest day can be unwound (`QX108`).** Emptying a counted day that isn't `last_streak_date`, or dropping a day below target when it isn't the habit's `last_date`, is refused. That fails closed: it's only reachable after a move west, when "today" is day D again and D+1 has already counted on D's streak. D+1's streak and saved before-states assume D, so no exact restore exists. The `test-writer` showed that the first draft, which skipped the restore but allowed the undo, let a later undo of D+1 bring back a streak and a milestone for a D with no completion. Any westward change works: complete just after midnight, switch west, and both days are inside the undo window, because the window is real time. Refusing can be over-strict for a D that counted under rule 0, or reached a habit target without advancing it. That's accepted and pinned by tests (W1, W2).
    - **Later completions' saved habit state is rewritten.** When an undo restores a habit's streak, the habit's completions on later days (below their target, or the undo would be refused) saved D's streak as their before-state. They're rewritten to the restored one.
    - **A day's completions are pinned when the habit streak advances** (audit L1). `complete_habit_at` is redefined in this migration: when the streak advances on a day, every completion of that habit on that day gets the pre-advance state. Without this, a relived D could advance the streak between two completions of D+1, and undoing the earlier one restored the state from before D.
    - pgTAP simulates the move west with the time seam ("now" runs backwards), and invariants pin "every streak ends on a day with a completion" and "every habit streak ends on a day that reached its target". Moving east is the exception: inheritance (#28) legitimately ends a streak on a new today with no completion.
  - **Freezes are given back as a delta.** `daily_progress.streak_freezes_used` records what the day's count spent. Undo adds it back, capped at `streak_freezes_max`, instead of restoring `streak_freezes_before`, so a freeze bought or granted between the count and the undo survives. At the cap, the extra freeze is lost; that is accepted. Rows written before this migration default to 0 used. Nothing is deployed, and the undo window is 15 minutes, so no backfill is needed.
  - **`profiles.lifetime_points >= 0`** is now a CHECK (audit I1). Undo lowers lifetime by the same cost as the balance, so a future credit that raises only the balance can't push it negative silently.
  - **Milestones** awarded on the emptied day are revoked as D8 describes. The balance check covers them, so "complete, spend, undo" can't go negative even with a milestone in play.
  - **`lifetime_points` decreases by the same amount as the balance,** which keeps the ledger invariant (`completion + streak_milestone + undo = lifetime`).
- **Today screen (#71).**
  - **One round trip per tap.** `completeHabit` and `undoCompletion` (`lib/today/actions.ts`) call the engine RPC, then `get_today`, and return both. The screen shows the event (floating points, milestone) and replaces its whole state with the fresh `get_today`, so streaks never come from a partial completion's stale `habit_streak` (D7). If `get_today` fails after the write, the client falls back to `router.refresh()`. If the write committed but its event can't be parsed, the action still reports success (`event: null`) with the fresh snapshot (review round 1): a failure there would revert a saved completion and invite a second tap.
  - **No `refresh()`, `updateTag` or `revalidatePath`.** Nothing on these pages is cached (`get_today` is dynamic and per user), and the action already returns the new state. `refresh()` would re-render the page and call `get_today` a second time. Other pages read their data fresh on the next navigation.
  - **Optimistic UI** uses `useOptimistic` over the last snapshot: a tap adds a pending occurrence (no undo button until it's real), an undo removes the completion. Any refusal reverts it, shows the mapped message in `role="alert"`, and refreshes on codes that mean the screen is out of date (not found, not scheduled, already done, undo too late). An action call that throws also refreshes, because a lost response can hide a committed write. `QX103` after a tap is a double tap racing the first (or a completion from another device), so it refreshes with a polite "already done" status and no alert.
  - **RPC JSON is parsed with zod** (`lib/today/types.ts`), not cast, so a contract change fails visibly instead of rendering wrong numbers.
  - **Undo deadline on the client.** A deadline clock (`useSyncExternalStore`) sets one timeout to the next `undoable_until` and re-renders only then, so an idle screen never ticks (review round 1). Its server snapshot is 0, which shows the button, so server and client HTML agree. The server re-checks the window anyway (`QX104`).
  - **Rollover.** The view refreshes when the date in the user's timezone is later than the snapshot's `local_date`, or when it passes 18:00 and the snapshot is from before, so the at-risk banner appears. It checks every minute and when the app regains focus or visibility. It's throttled to once a minute rather than once per day (review round 2), so a fast device clock or a failed refresh is retried until the server's snapshot catches up. It only fires when the device is ahead of the snapshot, so a slow clock doesn't refresh forever, and it skips hidden tabs (round 3).
  - **Activity.** With `cacheComponents`, a route the user leaves is hidden, not unmounted. A layout-effect cleanup clears the error, status, floats and confetti, so they don't come back on return.
  - **Accessibility.** Each card is one button named with its progress ("Complete Read, 1 of 3 done", "Read, done for today"), plus its habit streak. A done card stays focusable (`aria-disabled`). Pips, the floating points and the confetti are `aria-hidden`; a polite status region announces every result, including milestones, and an undo announces the streak and any revoked milestone. When the Undo button disappears while focused (used, or its window closed), focus moves to the card's main button rather than `<body>`.
  - **Reduced motion.** Under `prefers-reduced-motion`, confetti is hidden, the flame and the check pop don't animate, and the floating points fade in place. Milestones still get a toast and the announcement.
  - **Offline.** Completions are never queued (plan §8, the server is authoritative). A tap while `navigator.onLine` is false, or an action that fails to reach the server, shows "You're offline" (or a retry message) and reverts. `useOffline` isn't used: it needs `experimental.useOffline`, which also retries blocked Server Actions automatically, and a delayed replay of a completion isn't what we want. Viewing a cached Today offline is Phase 8 hardening.
  - **Settings shows the timezone cooldown** (#28): `timezone_changed_at + timezone_change_cooldown_days`, rounded up to the minute like the trigger's hint and shown in the user's timezone. It's display only; the trigger enforces it.
