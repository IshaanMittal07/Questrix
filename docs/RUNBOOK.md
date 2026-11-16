# Runbook

## Local development

1. Install Node 22+ and pnpm, then run `pnpm install`.
2. Start Docker Desktop.
3. Fill in `supabase/.env` (git-ignored) with the Google OAuth client credentials. See "Google sign-in" below; you can skip this if you don't need Google locally.
4. Run `pnpm db:start`. It starts the local Supabase stack on ports **55321–55329**: API `55321`, DB `55322`, Studio `55323`, Mailpit `55324`.
5. Create `.env.local` from `pnpm exec supabase status -o env`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```
6. Run `pnpm dev`, then open http://localhost:3000. Use `localhost` rather than `127.0.0.1`, so auth cookies match `site_url`.
7. Sign-in emails don't leave your machine. Read them in Mailpit at http://127.0.0.1:55324.

Tests: `pnpm test` (unit), `pnpm db:test` (pgTAP), `pnpm build && pnpm test:e2e` (Playwright; needs the local stack).

## Google sign-in

1. In Google Cloud Console, open **Google Auth Platform**. Set up branding and the audience (External), add yourself as a test user, and keep the scopes at `openid`, `email` and `profile`.
2. Go to **Clients → Create client → Web application**.
   - Authorized JavaScript origins: `http://localhost:3000`, plus the production URL later.
   - Authorized redirect URIs: `http://127.0.0.1:55321/auth/v1/callback` (local) and `https://<project-ref>.supabase.co/auth/v1/callback` (production).
3. Local: put the values in `supabase/.env` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, then restart with `pnpm exec supabase stop && pnpm db:start`.
4. Production: in the Supabase dashboard, go to **Authentication → Sign In / Providers → Google** and paste the same values.

## Production auth settings (Supabase dashboard)

- **Authentication → URL Configuration:** set the Site URL to the app URL. Add `https://<app>/auth/callback**` (the `**` lets the `?next=` query through) and `https://<app>/auth/confirm` to the redirect URLs.
- **Authentication → Emails → Magic Link** (and **Confirm signup**): paste `supabase/templates/magic_link.html` and set the subject to "Your Questrix sign-in code". The template must contain both `{{ .Token }}` and the `/auth/confirm?token_hash=...` link.

### Auth hardening checklist (before launch)

- **Sign In / Providers → Email:** confirm email **on**, secure password change **on**, minimum password length **≥ 8**, email OTP expiry **≤ 900 s**. The app is passwordless and the `strip_auth_password` trigger stores no password hash, but keep these on as a second layer.
- **Google:** `skip_nonce_check` must be **off** (it's on only in the local `config.toml`).
- **Custom SMTP:** set it under **Authentication → Emails → SMTP Settings**. The built-in sender is heavily rate-limited and not meant for production.
- **Rate limits (Authentication → Rate Limits):** these values are a starting point; tune them from real traffic. Emails sent per hour about 30 (needs custom SMTP), sign-ups and sign-ins per 5 minutes per IP about 30, token verifications per 5 minutes per IP about 30, token refreshes per 5 minutes per IP 150.
- **CAPTCHA (Cloudflare Turnstile):** create a Turnstile widget for the app's domain. Paste its **secret** under **Authentication → Attack Protection → Enable CAPTCHA protection** (provider: Turnstile), and set its **site key** as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel. Do both in the same deploy: with CAPTCHA on and no site key, sign-in requests are rejected. **This is a launch gate, not optional:** `/auth/v1/signup` can be used to send email to any address until CAPTCHA is on. When a site-wide CSP is added (Phase 8), allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
- **Passwordless trigger:** `strip_auth_password` on `auth.users` means any password (signup, `updateUser`, admin or dashboard "create user with password") is silently not stored. After the first `supabase db push` to a staging project, check that code sign-in, Google sign-in and admin invites still work.
- **Text-cleaning parity:** after the first `supabase db push`, run the four `habits_clean_text` parity selects at the end of `supabase/tests/020_habits_rls.sql` in the hosted SQL editor and check they return the expected values (the habit forms assume them).

## Production setup

_Phases 5 and 8 add Vercel env vars, the Supabase Vault secrets (`app_url`, `cron_secret`), pg_cron jobs and VAPID keys._
