# Runbook

## Local development

1. Install Node 22.22.2 or newer on the 22 line (the `engines` range in `package.json`; jsdom 31 needs it) and pnpm, then run `pnpm install`.
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
- **Node on Vercel:** `engines` is `>=22.22.2 <23` with `engineStrict`. On the first deploy, check the build log's Node.js line is 22.22.2 or newer; if Vercel's image ships an older 22.x, the install fails.

## Reminders and push notifications

Every minute, pg_cron runs `public.invoke_reminders()`. It reads two Vault secrets and POSTs to `/api/cron/reminders` through pg_net, and the route sends the pushes (DECISIONS P5–P9). Until both secrets exist, the job does nothing, so a fresh stack or CI never calls out.

### 1. Keys and the cron secret (once per environment)

```bash
pnpm dlx web-push generate-vapid-keys      # a public/private pair (base64url, no "=")
openssl rand -hex 32                        # CRON_SECRET: ASCII, at least 32 characters
```

Put these in `.env.local` locally, or the host's env settings in production. Never commit them.

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>              # server only
VAPID_SUBJECT=mailto:you@example.com        # a real address; Safari rejects localhost
CRON_SECRET=<hex from openssl>              # server only
```

A key pair that doesn't match, or a padded key, makes the route return 500 "Push is not configured" before it fetches anything. If keys are revoked later, every push fails, and the log says `all N pushes failed; check the VAPID keys`.

### 2. The Vault secrets (once per environment, outside git)

Run these in the SQL editor (Studio at http://127.0.0.1:55323 locally) or with psql. Never put them in `seed.sql` or a migration.

```sql
-- Locally: the database runs in Docker and reaches the host's Next server.
select vault.create_secret('http://host.docker.internal:3000', 'app_url');
-- Production: the deployed origin, e.g. https://your-app.example.
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');

-- To change one later:
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'cron_secret';
```

`host.docker.internal` works with Docker Desktop (Windows and macOS). On Linux, add the host-gateway mapping, or use the host's LAN address.

The `db reset` command recreates the database, so re-run these after a reset. Locally, the service worker registers only in production builds, so test push with `pnpm build && pnpm start`, not `pnpm dev`.

### 3. Check it's running

```sql
-- Recent runs of the minute job (success or error).
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

-- Recent responses from the route: {sent, failed, removed, skipped, malformed, truncated}.
select id, status_code, content::text, error_msg, created
from net._http_response order by created desc limit 10;
```

pg_net gives up waiting after 30 s, but the route can run for up to 60 s. A "timeout" row therefore only means the response was discarded; the run itself completes. Check the route's own log line, `reminders: {...}`, in the host's function logs.

Trigger a run by hand, without waiting for the minute:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

### 4. Pause, resume, remove

```sql
update cron.job set active = false where jobname = 'questrix-reminders';  -- pause
update cron.job set active = true  where jobname = 'questrix-reminders';  -- resume
select cron.unschedule('questrix-reminders');                             -- remove (a migration re-adds it)
```

The daily `questrix-push-log-cleanup` job (03:17 UTC) deletes reminder and streak-saver log rows older than 7 days. Never shorten that below 2 days: the log is what stops a timezone change re-firing a reminder.

### 5. Before turning it on in production

- **#79's rate limit on `save_push_subscription` must ship first** (security audit S2). Without it, a user can churn garbage endpoints, and every run would spend the app's standing with the push services.
- **Timezone names.** `due_reminders` is one statement for every user. If a tzdata upgrade ever drops a timezone name a profile stores, it would fail for everyone. tzdata keeps backward links, so this is unlikely. If `due_reminders` errors start appearing, check `select distinct timezone from profiles` against `pg_timezone_names`.

### 6. Testing on a real iPhone (no hosted Supabase)

iOS push needs HTTPS and an installed PWA. Without a hosted project:

1. Run the local stack and `pnpm build && pnpm start`.
2. Expose the app over HTTPS with a Cloudflare quick tunnel (no account needed): `cloudflared tunnel --url http://localhost:3000`. It prints an `https://<random>.trycloudflare.com` URL.
3. The phone must also reach the Supabase API. Either open a second tunnel for `http://127.0.0.1:55321` and build with `NEXT_PUBLIC_SUPABASE_URL` set to it, or proxy it through Next. Add the app's tunnel URL to `additional_redirect_urls` in `supabase/config.toml` and restart the stack.
4. Keep `app_url` in Vault as `http://host.docker.internal:3000`. pg_cron calls the local server directly, not through the tunnel.
5. On the iPhone, open the tunnel URL in Safari, use Share → Add to Home Screen, open the app from the Home Screen, and enable notifications from a tap.

## Production setup

_Phase 8 adds hosting. Phase 5's VAPID keys, cron secret, Vault secrets and pg_cron jobs are described under "Reminders and push notifications" above; the same steps apply in production with the deployed origin as `app_url`._
