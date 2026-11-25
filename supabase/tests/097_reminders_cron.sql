-- Phase 5 (#90): the reminders cron jobs, invoke_reminders and log cleanup.
-- Repeatable read: once real Vault secrets exist locally, the live minute
-- job commits (and the pg_net worker deletes) queue rows; this snapshot
-- keeps the counts below from racing them.
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
select plan(43);

create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue $$;

-- Replace both Vault secrets (null = absent). Inside the transaction, so rolled back.
create function pg_temp.set_secrets(p_url text, p_secret text) returns void language plpgsql as $$
begin
  delete from vault.secrets where name in ('app_url', 'cron_secret');
  if p_url is not null then perform vault.create_secret(p_url, 'app_url'); end if;
  if p_secret is not null then perform vault.create_secret(p_secret, 'cron_secret'); end if;
end $$;

-- ── The jobs ────────────────────────────────────────────────────────────────
select is((select schedule from cron.job where jobname = 'questrix-reminders'), '* * * * *',
  'the reminders job runs every minute');
select is((select command from cron.job where jobname = 'questrix-reminders'), 'select public.invoke_reminders()',
  'and calls invoke_reminders');
select is((select schedule from cron.job where jobname = 'questrix-push-log-cleanup'), '17 3 * * *',
  'the cleanup job runs daily');
select is((select count(*)::int from cron.job where jobname in ('questrix-reminders', 'questrix-push-log-cleanup')), 2, 'exactly two jobs');
select is((select command from cron.job where jobname = 'questrix-push-log-cleanup'),
  'select public.cleanup_push_logs()', 'and the cleanup job calls cleanup_push_logs');
select ok((select bool_and(username = 'postgres' and database = current_database() and active)
           from cron.job where jobname like 'questrix-%'),
  'both jobs are active and run as postgres in this database');
select is((select extnamespace::regnamespace::text from pg_extension where extname = 'pg_net'), 'extensions',
  'pg_net lives in the extensions schema');
select is((select extnamespace::regnamespace::text from pg_extension where extname = 'pg_cron'), 'pg_catalog',
  'pg_cron lives in pg_catalog (its only supported schema)');

-- Re-scheduling by name updates the job in place instead of adding one.
create temp table j0 as select jobid from cron.job where jobname = 'questrix-reminders';
select is(cron.schedule('questrix-reminders', '* * * * *', 'select public.invoke_reminders()'),
  (select jobid from j0), 'rerunning cron.schedule by name returns the same job id');
select cron.schedule('questrix-push-log-cleanup', '17 3 * * *', 'select public.cleanup_push_logs()');
select is((select count(*)::int from cron.job where jobname in ('questrix-reminders', 'questrix-push-log-cleanup')), 2, 'and still exactly two jobs');

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'authenticated', array[]::text[],
  'clients can''t call invoke_reminders');
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'anon', array[]::text[], 'nor can anon');
select function_privs_are('public', 'invoke_reminders', array[]::text[], 'service_role', array[]::text[],
  'nor service_role (only pg_cron, as postgres)');
select function_privs_are('public', 'cleanup_push_logs', array[]::text[], 'authenticated', array[]::text[],
  'clients can''t call cleanup_push_logs');
select function_privs_are('public', 'cleanup_push_logs', array[]::text[], 'anon', array[]::text[],
  'nor can anon call cleanup_push_logs');
select function_privs_are('public', 'cleanup_push_logs', array[]::text[], 'service_role', array[]::text[],
  'nor service_role call cleanup_push_logs');
select ok(has_function_privilege('postgres', 'public.invoke_reminders()', 'execute')
          and has_function_privilege('postgres', 'public.cleanup_push_logs()', 'execute'),
  'postgres (the cron job user) can execute both');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.invoke_reminders()'::regprocedure),
  'invoke_reminders is SECURITY DEFINER with an empty search_path');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.cleanup_push_logs()'::regprocedure),
  'cleanup_push_logs is SECURITY DEFINER with an empty search_path');

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
select ok((select convert_from(body, 'UTF8')::jsonb = '{}'::jsonb
                  and headers ->> 'Content-Type' = 'application/json'
           from net.http_request_queue where id = (select id from q1)),
  'the body is an empty JSON object sent as application/json');

-- ── URL and secret validation ───────────────────────────────────────────────
select pg_temp.set_secrets('https://app.example.com/', repeat('s', 64));
create temp table q2 as select public.invoke_reminders() as id;
select is((select url from net.http_request_queue where id = (select id from q2)),
  'https://app.example.com/api/cron/reminders', 'a trailing slash on app_url is joined without "//"');
select pg_temp.set_secrets('https://app.example.com///', repeat('s', 64));
create temp table q3 as select public.invoke_reminders() as id;
select is((select url from net.http_request_queue where id = (select id from q3)),
  'https://app.example.com/api/cron/reminders', 'and so are several trailing slashes');

create temp table q4 as select pg_temp.queued() as n;
select pg_temp.set_secrets('file:///etc', repeat('s', 64));
select is(public.invoke_reminders(), null::bigint, 'a file: app_url queues nothing');
select pg_temp.set_secrets('javascript:alert(1)', repeat('s', 64));
select is(public.invoke_reminders(), null::bigint, 'nor a javascript: one');
select pg_temp.set_secrets('ftp://app.example.com', repeat('s', 64));
select is(public.invoke_reminders(), null::bigint, 'nor an ftp: one');
select pg_temp.set_secrets('javascript://app.example.com', repeat('s', 64));
select is(public.invoke_reminders(), null::bigint, 'nor a javascript: one written like a URL');
select pg_temp.set_secrets(null, repeat('s', 64));
select is(public.invoke_reminders(), null::bigint, 'a missing app_url with a present secret queues nothing');
select pg_temp.set_secrets('https://app.example.com', null);
select is(public.invoke_reminders(), null::bigint, 'a missing secret with a present app_url queues nothing');
select pg_temp.set_secrets('https://app.example.com', repeat('s', 31));
select is(public.invoke_reminders(), null::bigint, 'a 31-character secret queues nothing');
select is(pg_temp.queued(), (select n from q4), 'none of the refused configurations queued a request');
select pg_temp.set_secrets('https://app.example.com', repeat('s', 32));
select isnt(public.invoke_reminders(), null::bigint, 'a secret of exactly 32 characters is accepted');

-- ── Cleanup keeps a week ────────────────────────────────────────────────────
-- now() is fixed inside the transaction, so the 7-day rows sit exactly on the
-- boundary (kept) and the 7-day-1-second rows just past it (deleted).
insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000001', 'c@example.com');
insert into public.habits (id, user_id, title, category)
values ('99999999-0000-0000-0000-0000000000aa', '99999999-0000-0000-0000-000000000001', 'H', 'mind');
insert into public.reminder_log (habit_id, local_date, reminder_time, user_id, sent_at) values
  ('99999999-0000-0000-0000-0000000000aa', current_date - 10, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('99999999-0000-0000-0000-0000000000aa', current_date - 8, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '7 days 1 second'),
  ('99999999-0000-0000-0000-0000000000aa', current_date - 7, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '7 days'),
  ('99999999-0000-0000-0000-0000000000aa', current_date - 2, '08:00', '99999999-0000-0000-0000-000000000001', now() - interval '2 days');
insert into public.streak_saver_log (user_id, local_date, sent_at) values
  ('99999999-0000-0000-0000-000000000001', current_date - 10, now() - interval '10 days'),
  ('99999999-0000-0000-0000-000000000001', current_date - 8, now() - interval '7 days 1 second'),
  ('99999999-0000-0000-0000-000000000001', current_date - 7, now() - interval '7 days'),
  ('99999999-0000-0000-0000-000000000001', current_date - 2, now() - interval '2 days');
select public.cleanup_push_logs();
select is((select array_agg(local_date order by local_date) from public.reminder_log
           where user_id = '99999999-0000-0000-0000-000000000001'),
  array[current_date - 7, current_date - 2],
  'cleanup removes reminder log rows older than 7 days and keeps the rest, exactly 7 days included');
select is((select array_agg(local_date order by local_date) from public.streak_saver_log
           where user_id = '99999999-0000-0000-0000-000000000001'),
  array[current_date - 7, current_date - 2], 'and the same for the streak saver log');

-- ── Review of PR #98: cleartext, trimming, run history ───────────────────────
select pg_temp.set_secrets('http://app.example.com', repeat('s', 64));
select is(public.invoke_reminders(), null::bigint,
  'plain http to another host is refused: the bearer never crosses a network in cleartext');
select pg_temp.set_secrets('http://localhost:3000', repeat('s', 64));
select ok(public.invoke_reminders() is not null, 'plain http to this machine is allowed (local development)');
select pg_temp.set_secrets('https://trim.example.com/' || chr(10), repeat('t', 64) || chr(10));
create temp table q9 as select public.invoke_reminders() as id;
select ok((select url = 'https://trim.example.com/api/cron/reminders'
                  and headers ->> 'Authorization' = 'Bearer ' || repeat('t', 64)
           from net.http_request_queue where id = (select id from q9)),
  'pasted values are trimmed (a trailing newline would fail every run)');
insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
values ((select jobid from cron.job where jobname = 'questrix-reminders'), -1, current_database(), 'postgres',
        'old', 'succeeded', now() - interval '8 days', now() - interval '8 days'),
       ((select jobid from cron.job where jobname = 'questrix-reminders'), -2, current_database(), 'postgres',
        'crashed', 'running', now() - interval '8 days', null),
       ((select jobid from cron.job where jobname = 'questrix-reminders'), -3, current_database(), 'postgres',
        'recent', 'succeeded', now() - interval '1 day', now() - interval '1 day');
select public.cleanup_push_logs();
select is((select array_agg(command order by runid) from cron.job_run_details where runid < 0), array['recent'],
  'cleanup prunes run history older than 7 days, including runs that never ended, and keeps recent runs');
select is((select count(*)::int from cron.job where jobname in ('questrix-reminders', 'questrix-push-log-cleanup')), 2,
  'and leaves the jobs themselves alone');

select * from finish();
rollback;
