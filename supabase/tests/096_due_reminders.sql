-- Phase 5 (#88): due_reminders and due_streak_savers — timezones, the
-- (now − 2 min, now] window, midnight and DST, exclusions, idempotency.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create function pg_temp.u(n int) returns uuid language sql as $$
  select ('6000000' || n || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.h(n int, m int default 1) returns uuid language sql as $$
  select ('d00000' || n || m || '-0000-0000-0000-000000000000')::uuid $$;
-- Rows due at p_now for user n (calls due_reminders, so it logs them).
create temp table got (n int, k text, habit_id uuid, local_date date, reminder_time time, points int, streak int);
create function pg_temp.run(p_k text, p_now timestamptz) returns int language sql as $$
  with r as (select * from public.due_reminders(p_now))
  insert into got select (select g from generate_series(1, 9) g where pg_temp.u(g) = r.user_id),
                         p_k, r.habit_id, r.local_date, r.reminder_time, r.points, r.streak from r
  returning 1 $$;
create function pg_temp.has(p_k text, p_habit uuid) returns boolean language sql as $$
  select exists (select 1 from got where k = p_k and habit_id = p_habit) $$;
create function pg_temp.sub(n int) returns void language sql as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (pg_temp.u(n), 'https://fcm.googleapis.com/fcm/send/u' || n, repeat('A', 87), repeat('a', 22)) $$;

-- Users: 1 Honolulu (UTC-10), 2 Auckland (UTC+13 in December),
-- 3 Toronto (DST), 4 push off, 5 no subscription, 6 not onboarded,
-- 7 streak saver, 8 streak 2, 9 saver off.
insert into auth.users (id, email) select pg_temp.u(g), 'r' || g || '@example.com' from generate_series(1, 9) g;
update public.profiles set timezone = case
    when id = pg_temp.u(2) then 'Pacific/Auckland'
    when id = pg_temp.u(3) then 'America/Toronto'
    else 'Pacific/Honolulu' end
  where id in (select pg_temp.u(g) from generate_series(1, 9) g);
update public.profiles set onboarded_at = '2026-10-01 00:00+00'
  where id in (select pg_temp.u(g) from generate_series(1, 9) g) and id <> pg_temp.u(6);
update public.profiles set push_enabled = false where id = pg_temp.u(4);
update public.profiles set streak_saver_enabled = false where id = pg_temp.u(9);
select pg_temp.sub(g) from generate_series(1, 9) g where g <> 5;

insert into public.habits (id, user_id, title, category, difficulty, reminder_times, created_at) values
  -- U1: the window, completions, exclusions
  (pg_temp.h(1, 1), pg_temp.u(1), 'Edge', 'mind', 'hard', '{07:58,07:59,08:00,08:01}', '2026-10-01'),
  (pg_temp.h(1, 2), pg_temp.u(1), 'Night', 'mind', 'easy', '{23:59}', '2026-10-01'),
  (pg_temp.h(1, 3), pg_temp.u(1), 'Archived', 'mind', 'easy', '{08:00}', '2026-10-01'),
  (pg_temp.h(1, 4), pg_temp.u(1), 'Muted', 'mind', 'easy', '{08:00}', '2026-10-01'),
  (pg_temp.h(1, 5), pg_temp.u(1), 'Done', 'mind', 'easy', '{09:00}', '2026-10-01'),
  (pg_temp.h(1, 6), pg_temp.u(1), 'Snapshot', 'mind', 'easy', '{10:00}', '2026-10-01'),
  (pg_temp.h(2, 1), pg_temp.u(2), 'Midnight', 'mind', 'medium', '{00:00}', '2026-10-01'),
  (pg_temp.h(3, 1), pg_temp.u(3), 'Spring', 'mind', 'easy', '{02:30}', '2026-10-01'),
  (pg_temp.h(3, 2), pg_temp.u(3), 'Fall', 'mind', 'easy', '{01:30}', '2026-10-01'),
  (pg_temp.h(4, 1), pg_temp.u(4), 'Off', 'mind', 'easy', '{08:00}', '2026-10-01'),
  (pg_temp.h(5, 1), pg_temp.u(5), 'No device', 'mind', 'easy', '{08:00}', '2026-10-01'),
  (pg_temp.h(6, 1), pg_temp.u(6), 'New', 'mind', 'easy', '{08:00}', '2026-10-01'),
  (pg_temp.h(7, 1), pg_temp.u(7), 'Daily', 'mind', 'easy', '{}', '2026-10-01'),
  (pg_temp.h(8, 1), pg_temp.u(8), 'Daily', 'mind', 'easy', '{}', '2026-10-01'),
  (pg_temp.h(9, 1), pg_temp.u(9), 'Daily', 'mind', 'easy', '{}', '2026-10-01');
update public.habits set archived_at = '2026-11-01' where id = pg_temp.h(1, 3);
update public.habits set reminders_enabled = false where id = pg_temp.h(1, 4);
-- U1's "Weekday" habit: never on the test day's weekday (2026-12-01 is a Tuesday).
insert into public.habits (id, user_id, title, category, days_of_week, reminder_times, created_at)
values (pg_temp.h(1, 7), pg_temp.u(1), 'Not Tuesday', 'mind', '{0,1,3,4,5,6}', '{08:00}', '2026-10-01');

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'due_reminders', array['timestamp with time zone'], 'authenticated', array[]::text[],
  'clients can''t call due_reminders');
select function_privs_are('public', 'due_reminders', array['timestamp with time zone'], 'anon', array[]::text[], 'nor can anon');
select function_privs_are('public', 'due_reminders', array['timestamp with time zone'], 'service_role', array['EXECUTE'],
  'the cron route (service_role) can');
select function_privs_are('public', 'due_streak_savers', array['timestamp with time zone'], 'authenticated', array[]::text[],
  'clients can''t call due_streak_savers');
select function_privs_are('public', 'due_streak_savers', array['timestamp with time zone'], 'service_role', array['EXECUTE'],
  'service_role can');

-- ── The window: (now − 2 min, now], seconds truncated ───────────────────────
-- 2026-12-01 08:00:59 in Honolulu is 18:00:59 UTC.
select pg_temp.run('w', '2026-12-01 18:00:59+00');
select is((select array_agg(reminder_time order by reminder_time) from got where k = 'w' and habit_id = pg_temp.h(1, 1)),
  array['07:59', '08:00']::time[], 'the window is (07:58, 08:00]: 07:58 is out, 08:01 hasn''t come');
select is((select local_date from got where k = 'w' and habit_id = pg_temp.h(1, 1) limit 1), '2026-12-01'::date,
  'judged on the user''s local date');
select is((select points from got where k = 'w' and habit_id = pg_temp.h(1, 1) limit 1),
  (public.economy_value('base_points') ->> 'hard')::int, 'it carries the base points for the difficulty');
select ok(not pg_temp.has('w', pg_temp.h(1, 3)), 'archived habits are skipped');
select ok(not pg_temp.has('w', pg_temp.h(1, 4)), 'and habits with reminders off');
select ok(not pg_temp.has('w', pg_temp.h(1, 7)), 'and habits not scheduled that weekday');
select ok(not exists (select 1 from got where k = 'w' and n in (4, 5, 6)),
  'push off, no device and not onboarded are all skipped');
select ok(not exists (select 1 from public.reminder_log where user_id = pg_temp.u(5)),
  'and nothing is logged for a user without a device');
-- Overlapping windows: 08:01:30 covers (07:59, 08:01], 08:02:10 covers (08:00, 08:02].
select pg_temp.run('w2', '2026-12-01 18:01:30+00');
select is((select array_agg(reminder_time) from got where k = 'w2' and habit_id = pg_temp.h(1, 1)), array['08:01']::time[],
  'an overlapping run sends only the newly due 08:01, not 07:59 or 08:00 again');
select is(pg_temp.run('w3', '2026-12-01 18:02:10+00'), null, 'and the next run sends nothing (idempotent)');
select is((select count(*)::int from public.reminder_log where habit_id = pg_temp.h(1, 1)), 3, '(each reminder is logged once)');

-- ── Midnight: a window crossing local midnight ──────────────────────────────
-- 2026-12-02 00:00:30 Honolulu = 10:00:30 UTC; window (23:58, 00:00].
select pg_temp.run('m', '2026-12-02 10:00:30+00');
select is((select local_date from got where k = 'm' and habit_id = pg_temp.h(1, 2)), '2026-12-01'::date,
  'a 23:59 reminder is found across midnight, on its own date');

-- ── A local date that differs from UTC's ────────────────────────────────────
-- 2026-12-01 11:00:20 UTC is 2026-12-02 00:00:20 in Auckland (UTC+13).
select pg_temp.run('nz', '2026-12-01 11:00:20+00');
select is((select local_date from got where k = 'nz' and habit_id = pg_temp.h(2, 1)), '2026-12-02'::date,
  'Auckland''s 00:00 reminder fires on its local date, a day ahead of UTC');
select is((select points from got where k = 'nz'), (public.economy_value('base_points') ->> 'medium')::int, '(medium points)');

-- ── Done for the day, and the snapshot's target ─────────────────────────────
select public.complete_habit_at(pg_temp.u(1), pg_temp.h(1, 5), '2026-12-01 18:30+00');
select pg_temp.run('d', '2026-12-01 19:00:05+00');
select ok(not pg_temp.has('d', pg_temp.h(1, 5)), 'a habit done for the day isn''t reminded');
-- Today's snapshot says target 1; the live habit is raised to 3 afterwards.
update public.habits set target_per_day = 3 where id = pg_temp.h(1, 6);
select public.complete_habit_at(pg_temp.u(1), pg_temp.h(1, 6), '2026-12-01 19:30+00');
select pg_temp.run('s', '2026-12-01 20:00:05+00');
select ok(not pg_temp.has('s', pg_temp.h(1, 6)), 'the snapshot''s target decides (1 of 1 done), not the live 3');
-- A day with no snapshot falls back to the live habit (target 3, none done).
select pg_temp.run('s2', '2026-12-03 20:00:05+00');
select ok(pg_temp.has('s2', pg_temp.h(1, 6)), 'with no snapshot, the live schedule decides');
select ok(not exists (select 1 from public.daily_schedule where user_id = pg_temp.u(1) and local_date = '2026-12-03'),
  'and due_reminders never takes a snapshot itself');

-- ── DST in Toronto ──────────────────────────────────────────────────────────
-- 2027-03-14 02:30 doesn't exist (clocks jump 02:00 → 03:00 EDT): it maps to
-- 03:30 EDT = 07:30 UTC.
select pg_temp.run('sp', '2027-03-14 07:30:10+00');
select ok(pg_temp.has('sp', pg_temp.h(3, 1)), 'a skipped local time fires once, just after the jump');
select is((select count(*)::int from public.reminder_log where habit_id = pg_temp.h(3, 1) and local_date = '2027-03-14'), 1,
  '(once)');
-- 2027-11-07 01:30 happens twice (05:30 and 06:30 UTC): sent once.
select pg_temp.run('f1', '2027-11-07 05:30:10+00');
select pg_temp.run('f2', '2027-11-07 06:30:10+00');
select is((select count(*)::int from got where k in ('f1', 'f2') and habit_id = pg_temp.h(3, 2)), 1,
  'a repeated local time is sent once');

-- ── Streaks reported only while live ────────────────────────────────────────
update public.profiles set current_streak = 12, last_streak_date = '2026-11-30' where id = pg_temp.u(1);
delete from public.reminder_log where user_id = pg_temp.u(1);
select pg_temp.run('st', '2026-12-01 18:00:59+00');
update public.profiles set last_streak_date = '2026-11-28' where id = pg_temp.u(1);
delete from public.reminder_log where user_id = pg_temp.u(1);
select pg_temp.run('st2', '2026-12-01 18:00:59+00');
select ok((select bool_and(streak = 12) from got where k = 'st')
          and (select bool_and(streak = 0) from got where k = 'st2'),
  'the streak is reported while live, and as 0 once it can''t be (never overclaims)');

-- ── Streak saver ────────────────────────────────────────────────────────────
-- Users 7, 8 and 9: a streak ending yesterday (2026-12-01), nothing today.
update public.profiles set current_streak = case when id = pg_temp.u(8) then 2 else 3 end,
       longest_streak = 3, last_streak_date = '2026-12-01', streak_run_started = '2026-11-29'
 where id in (pg_temp.u(7), pg_temp.u(8), pg_temp.u(9));
create temp table sv as select * from public.due_streak_savers('2026-12-03 06:00:20+00');  -- 20:00 on 12-02 in Honolulu
select ok(exists (select 1 from sv where user_id = pg_temp.u(7) and local_date = '2026-12-02' and streak = 3),
  'at 20:00 a streak of 3 at risk gets the saver');
select ok(not exists (select 1 from sv where user_id in (pg_temp.u(8), pg_temp.u(9))),
  'a streak of 2, or the saver switched off, gets none');
select is((select count(*)::int from public.due_streak_savers('2026-12-03 06:01:20+00')), 0, 'sent once per day');
select is((select count(*)::int from public.due_streak_savers('2026-12-03 05:00:20+00')), 0, 'and only at 20:00');
-- A counted day isn't at risk.
update public.profiles set last_streak_date = '2026-12-03', current_streak = 4 where id = pg_temp.u(9);
update public.profiles set streak_saver_enabled = true where id = pg_temp.u(9);
select is((select count(*)::int from public.due_streak_savers('2026-12-04 06:00:20+00') where user_id = pg_temp.u(9)), 0,
  'a day already counted gets no saver');
-- A rest day (nothing scheduled) isn't at risk either.
update public.habits set days_of_week = '{1}' where id = pg_temp.h(7, 1);  -- Mondays only
update public.profiles set last_streak_date = '2026-12-03', current_streak = 3 where id = pg_temp.u(7);
select is((select count(*)::int from public.due_streak_savers('2026-12-05 06:00:20+00') where user_id = pg_temp.u(7)), 0,
  'a rest day gets no saver');
select * from finish();
rollback;
