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

- **Authentication → URL Configuration:** set the Site URL to the app URL. Add `https://<app>/auth/callback` and `https://<app>/auth/confirm` to the redirect URLs.
- **Authentication → Emails → Magic Link** (and **Confirm signup**): paste `supabase/templates/magic_link.html` and set the subject to "Your Questrix sign-in code". The template must contain both `{{ .Token }}` and the `/auth/confirm?token_hash=...` link.

## Production setup

_Phases 5 and 8 add Vercel env vars, the Supabase Vault secrets (`app_url`, `cron_secret`), pg_cron jobs and VAPID keys._
