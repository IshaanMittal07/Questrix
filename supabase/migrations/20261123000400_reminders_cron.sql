-- Phase 5 (#90): schedule the reminders cron (plan §7.2; DECISIONS P9).
--
-- pg_cron runs public.invoke_reminders() every minute. It reads the app URL
-- and the cron secret from Supabase Vault at run time and POSTs to
-- /api/cron/reminders through pg_net. With either secret missing (a fresh
-- local stack, CI, any environment not set up yet) it does nothing, so no
-- request is ever made to a null URL. The secrets are created per
-- environment outside git (docs/RUNBOOK.md).
--
-- A daily job deletes reminder and streak-saver log rows older than 7 days.
-- At least 2 days must stay, so a timezone change can't re-fire a reminder
-- whose row was purged (P5).
--
-- D2: pg_cron enters the stack here for reminders only; daily snapshots
-- stay lazy.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

/**
 * Queue one POST to the reminders route and return pg_net's request id, or
 * null when the Vault secrets aren't set up. Internal: called by pg_cron as
 * postgres; no client role can execute it.
 */
create function public.invoke_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s where s.name = 'app_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s where s.name = 'cron_secret';
  -- The route refuses secrets under 32 characters (lib/http/bearer.ts).
  if v_url is null or v_url !~* '^https?://' or v_secret is null or length(v_secret) < 32 then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/reminders',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'),
    -- pg_net's default is a few seconds; the route can take up to 60 (P8).
    -- A timeout only discards the response: the run still completes.
    timeout_milliseconds := 30000);
end;
$$;

/** Delete reminder and streak-saver log rows older than 7 days. */
create function public.cleanup_push_logs()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.reminder_log where sent_at < now() - interval '7 days';
  delete from public.streak_saver_log where sent_at < now() - interval '7 days';
$$;

revoke all on function public.invoke_reminders() from public, anon, authenticated, service_role;
revoke all on function public.cleanup_push_logs() from public, anon, authenticated, service_role;

-- By name, so re-running a migration updates the job instead of adding one.
select cron.schedule('questrix-reminders', '* * * * *', 'select public.invoke_reminders()');
select cron.schedule('questrix-push-log-cleanup', '17 3 * * *', 'select public.cleanup_push_logs()');
