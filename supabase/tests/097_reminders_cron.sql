-- Phase 5 (#90): the reminders cron jobs, invoke_reminders and log cleanup.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue $$;

-- ── The jobs ────────────────────────────────────────────────────────────────
select is((select schedule from cron.job where jobname = 'questrix-reminders'), '* * * * *',
  'the reminders job runs every minute');
select is((select command from cron.job where jobname = 'questrix-reminders'), 'select public.invoke_reminders()',
  'and calls invoke_reminders');
select is((select schedule from cron.job where jobname = 'questrix-push-log-cleanup'), '17 3 * * *',
  'the cleanup job runs daily');
select is((select count(*)::int from cron.job where jobname like 'questrix-%'), 2, 'exactly two jobs');

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'authenticated', array[]::text[],
  'clients can''t call invoke_reminders');
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'anon', array[]::text[], 'nor can anon');
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'service_role', array[]::text[],
  'nor service_role (only pg_cron, as postgres)');
select function_privs_are('public', 'cleanup_push_logs', array[]::text[], 'authenticated', array[]::text[],
  'clients can''t call cleanup_push_logs');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.invoke_reminders()'::regprocedure),
  'invoke_reminders is SECURITY DEFINER with an empty search_path');

-- ── No secrets, no request ──────────────────────────────────────────────────
delete from vault.secrets where name in ('app_url', 'cron_secret');
create temp table q0 as select pg_temp.queued() as n;
select is(public.invoke_reminders(), null::bigint, 'without the Vault secrets it does nothing');
select is(pg_temp.queued(), (select n from q0), 'and queues no request');
select vault.create_secret('http://host.docker.internal:3000', 'app_url');
select vault.create_secret('short', 'cron_secret');
select is(public.invoke_reminders(), null::bigint, 'a secret the route would refuse (under 32) queues nothing either');

-- ── With secrets: exactly one POST, with the bearer and a 30 s timeout ──────
select vault.update_secret(id, repeat('s', 64)) from vault.secrets where name = 'cron_secret';
create temp table q1 as select public.invoke_reminders() as id;
select ok((select id from q1) is not null and pg_temp.queued() = (select n from q0) + 1,
  'with both secrets it queues exactly one request');
select ok((select method = 'POST' and url = 'http://host.docker.internal:3000/api/cron/reminders'
                  and headers ->> 'Authorization' = 'Bearer ' || repeat('s', 64)
                  and timeout_milliseconds = 30000
           from net.http_request_queue where id = (select id from q1)),
  'a POST to /api/cron/reminders with the bearer secret and a 30 s timeout');

-- ── Cleanup keeps a week ────────────────────────────────────────────────────
insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000001', 'c@example.com');
insert into public.habits (id, user_id, title, category)
values ('99999999-0000-0000-0000-0000000000aa', '99999999-0000-0000-0000-000000000001', 'H', 'mind');
insert into public.reminder_log (habit_id, local_date, reminder_time, user_id, sent_at) values
  ('99999999-0000-0000-0000-0000000000aa', current_date - 10, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('99999999-0000-0000-0000-0000000000aa', current_date - 2, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '2 days');
insert into public.streak_saver_log (user_id, local_date, sent_at) values
  ('99999999-0000-0000-0000-000000000001', current_date - 10, now() - interval '10 days'),
  ('99999999-0000-0000-0000-000000000001', current_date - 2, now() - interval '2 days');
select public.cleanup_push_logs();
select is((select array_agg(local_date) from public.reminder_log where user_id = '99999999-0000-0000-0000-000000000001'),
  array[current_date - 2], 'cleanup removes reminder log rows older than 7 days and keeps recent ones');
select is((select array_agg(local_date) from public.streak_saver_log where user_id = '99999999-0000-0000-0000-000000000001'),
  array[current_date - 2], 'and the same for the streak saver log');

select * from finish();
rollback;
