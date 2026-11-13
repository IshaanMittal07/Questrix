# Decisions

A running log of choices made where the plan was ambiguous or where current tooling differed from it.

## Phase 0

- **Repository visibility:** the repo `IshaanMittal07/Questrix` already existed and is **public**, so it was reused instead of running `gh repo create`. Because it's public, branch protection is available.
- **Typecheck script:** `next typegen && tsc --noEmit` instead of plain `tsc --noEmit`. Next 16 generates global route types (`LayoutProps`, `PageProps`) into `.next/types`, and a clean CI checkout doesn't have them until `next typegen` runs.
- **jsdom pinned to ^29:** jsdom 30+ requires Node ≥ 22.22.2. The local machine runs Node 22.14, and jsdom 29 supports `^22.13`. CI runs Node 22 (`.nvmrc`). Bump to the latest jsdom once local Node is upgraded.
- **Supabase CLI as a devDependency** (`supabase` npm package, run with `pnpm exec supabase` or the `db:*` scripts), so the version is pinned in the lockfile. CI uses `supabase/setup-cli` with the same version.
- **Line endings:** `.gitattributes` forces LF and Prettier uses `endOfLine: lf`, so Windows checkouts and CI agree.
- **Plan copies:** `QUESTRIX_BUILD_PLAN.md` (the original) stays at the root and `docs/BUILD_PLAN.md` is the maintained copy, as plan §10 asks. Both are excluded from Prettier so they stay verbatim.
- **create-next-app extras:** Next 16's scaffold adds `AGENTS.md` (Next.js agent rules, which say to read `node_modules/next/dist/docs/` before coding), enables `cacheComponents` and `partialPrefetching`, and uses `@tailwindcss/turbopack`. All of these are kept as generated.
- **pgTAP smoke test** (`supabase/tests/000_smoke.sql`) exists so `supabase test db` has something to run before Phase 2 adds real tables.
- **Branch protection on `main`:** PRs are required, with **0 required approvals**, because GitHub doesn't let you approve your own PR and this is a solo repo. Required checks are `ci` and `db-tests` (strict, so the branch must be up to date), linear history is on, force pushes and deletions are off, and the rules apply to admins too. Add `e2e` to the required checks in Phase 3.
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
