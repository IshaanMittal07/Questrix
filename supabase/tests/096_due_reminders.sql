-- Phase 5 (#88): due_reminders and due_streak_savers — timezones, the
-- (now − 2 min, now] window, midnight and DST, exclusions, idempotency.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

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
select function_privs_are('public', 'due_streak_savers', array['timestamp with time zone'], 'anon', array[]::text[],
  'anon can''t call due_streak_savers');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc
           where oid = 'public.due_reminders(timestamptz)'::regprocedure),
  'due_reminders is SECURITY DEFINER with an empty search_path');
select ok((select prosecdef and proconfig @> array['search_path=""', 'lock_timeout=2s'] from pg_proc
           where oid = 'public.due_streak_savers(timestamptz)'::regprocedure),
  'due_streak_savers is SECURITY DEFINER with an empty search_path and a 2 s lock timeout');
select ok((select relrowsecurity from pg_class where oid = 'public.streak_saver_log'::regclass), 'streak_saver_log has RLS');
select col_is_pk('public', 'streak_saver_log', array['user_id', 'local_date'],
  'streak_saver_log is keyed by (user, local date): one saver a day');
select table_privs_are('public', 'streak_saver_log', 'authenticated', array[]::text[],
  'clients have no access to streak_saver_log');
select table_privs_are('public', 'streak_saver_log', 'anon', array[]::text[], 'nor does anon');
-- As reminder_log in 095 (DECISIONS P5).
select table_privs_are('public', 'streak_saver_log', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has no TRUNCATE, TRIGGER or REFERENCES on streak_saver_log');

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

-- ── More users ──────────────────────────────────────────────────────────────
-- v(1) a habit created today, v(2) a timezone change, v(3)..v(8) savers.
-- Savers v(3)..v(6) are in Honolulu; v(7) and v(8) in Kolkata, alone in
-- their window.
create function pg_temp.v(n int) returns uuid language sql as $$
  select ('7000000' || n || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.hv(n int, m int default 1) returns uuid language sql as $$
  select ('e00000' || n || m || '-0000-0000-0000-000000000000')::uuid $$;
insert into auth.users (id, email) select pg_temp.v(g), 'v' || g || '@example.com' from generate_series(1, 8) g;
update public.profiles set timezone = case when id in (pg_temp.v(7), pg_temp.v(8)) then 'Asia/Kolkata'
                                           else 'Pacific/Honolulu' end
  where id in (select pg_temp.v(g) from generate_series(1, 8) g);
update public.profiles set onboarded_at = '2026-10-01 00:00+00'
  where id in (select pg_temp.v(g) from generate_series(1, 8) g);
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select pg_temp.v(g), 'https://fcm.googleapis.com/fcm/send/v' || g, repeat('A', 87), repeat('a', 22)
from generate_series(1, 8) g;

-- ── Several devices, a target of 2, a habit outside the snapshot ────────────
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (pg_temp.u(1), 'https://fcm.googleapis.com/fcm/send/u1b', repeat('B', 87), repeat('b', 22));
insert into public.habits (id, user_id, title, category, target_per_day, reminder_times, created_at) values
  (pg_temp.h(1, 8), pg_temp.u(1), 'Later', 'mind', 1, '{11:00}', '2026-10-01'),
  (pg_temp.h(1, 9), pg_temp.u(1), 'Twice', 'mind', 2, '{12:00,13:00}', '2026-10-01');
-- 2026-12-08 (no snapshot yet): one of two done at 11:00 Honolulu.
select public.complete_habit_at(pg_temp.u(1), pg_temp.h(1, 9), '2026-12-08 21:00+00');
select pg_temp.run('t1', '2026-12-08 22:00:30+00');
select is((select count(*)::int from got where k = 't1' and habit_id = pg_temp.h(1, 9)), 1,
  'one done of a target of 2 is still reminded, once although the user has two devices');
select public.complete_habit_at(pg_temp.u(1), pg_temp.h(1, 9), '2026-12-08 22:30+00');
select pg_temp.run('t2', '2026-12-08 23:00:30+00');
select ok(not pg_temp.has('t2', pg_temp.h(1, 9)), 'two of two done: the 13:00 reminder isn''t sent');
-- 'Later' is live and scheduled every day, but 2026-12-01's snapshot was
-- taken before it existed (the cap case: snapshot_add_habit didn't add it).
select pg_temp.run('x', '2026-12-01 21:00:30+00');
select ok(not pg_temp.has('x', pg_temp.h(1, 8)), 'a habit missing from the day''s snapshot isn''t reminded that day');

-- ── A habit created today joins today's snapshot late, and is reminded ──────
-- The insert snapshots today first, then snapshot_add_habit adds the habit
-- (initial = false, #82). Real now(): the habit triggers use it.
insert into public.habits (id, user_id, title, category, reminder_times)
values (pg_temp.hv(1), pg_temp.v(1), 'Fresh', 'mind',
        array[date_trunc('minute', now() at time zone 'Pacific/Honolulu')::time]);
select is((select sh.initial from public.daily_schedule_habits sh
           where sh.habit_id = pg_temp.hv(1) and sh.local_date = public.local_date_in('Pacific/Honolulu', now())),
  false, '(it joined today''s snapshot late)');
select pg_temp.run('late', now());
select ok(pg_temp.has('late', pg_temp.hv(1)), 'a habit that joined today late is reminded today');

-- ── A timezone change between runs ──────────────────────────────────────────
insert into public.habits (id, user_id, title, category, reminder_times, created_at)
values (pg_temp.hv(2), pg_temp.v(2), 'Morning', 'mind', '{08:00}', '2026-10-01');
select pg_temp.run('tz1', '2026-12-01 18:00:30+00');  -- 08:00 in Honolulu
select ok(pg_temp.has('tz1', pg_temp.hv(2)), '(08:00 in Honolulu is sent)');
-- One hour west: 08:00 in Pago Pago (UTC-11) is 19:00 UTC, the same local date.
update public.profiles set timezone = 'Pacific/Pago_Pago' where id = pg_temp.v(2);
select pg_temp.run('tz2', '2026-12-01 19:00:30+00');
select ok(not pg_temp.has('tz2', pg_temp.hv(2)),
  'after a move west, the same local date''s 08:00 isn''t sent again (the log key)');
select pg_temp.run('tz3', '2026-12-02 19:00:30+00');
select is((select local_date from got where k = 'tz3' and habit_id = pg_temp.hv(2)), '2026-12-02'::date,
  'and the next day''s is, in the new timezone');

-- ── Streak saver: get_today decides ─────────────────────────────────────────
-- All at 20:00 on 2026-12-02 (a Wednesday) in Honolulu, nothing done that day.
-- v(3) control; v(4) relived (#81); v(5) completed only a late joiner and
-- v(6) has only a late joiner on the list (#82); v(7) streak broken by missed
-- days; v(8) the same with freezes to cover them.
insert into public.habits (id, user_id, title, category, days_of_week, created_at)
select pg_temp.hv(g), pg_temp.v(g), 'Daily', 'mind',
       case when g = 6 then '{0,1,2,4,5,6}'::smallint[] else '{0,1,2,3,4,5,6}'::smallint[] end, '2026-10-01'
from generate_series(3, 6) g;
update public.profiles set current_streak = 5, longest_streak = 5, last_streak_date = '2026-12-01',
       streak_run_started = '2026-11-27'
 where id in (select pg_temp.v(g) from generate_series(3, 6) g);
-- v(4) already reached 2026-12-03 before moving west; freezes, so only the
-- relived rule can stop the saver.
update public.profiles set engine_floor_date = '2026-12-03', streak_freezes = 2 where id = pg_temp.v(4);
-- v(5): 'Daily' is in the day's first snapshot; 'Bonus' joins at 19:00 and is done.
select public.ensure_daily_schedule(pg_temp.v(5), '2026-12-03 05:00+00');
insert into public.habits (id, user_id, title, category, created_at)
values (pg_temp.hv(5, 2), pg_temp.v(5), 'Bonus', 'mind', '2026-10-01');
select public.snapshot_add_habit(pg_temp.v(5), pg_temp.hv(5, 2), '2026-12-03 05:00+00');
select public.complete_habit_at(pg_temp.v(5), pg_temp.hv(5, 2), '2026-12-03 05:10+00');
-- v(6): the first snapshot is empty (not a Wednesday habit); it's then
-- rescheduled and joins late.
select public.ensure_daily_schedule(pg_temp.v(6), '2026-12-03 05:00+00');
update public.habits set days_of_week = '{0,1,2,3,4,5,6}' where id = pg_temp.hv(6);
select public.snapshot_add_habit(pg_temp.v(6), pg_temp.hv(6), '2026-12-03 05:00+00');
select ok((select s.scheduled_count = 0 and not sh.initial
           from public.daily_schedule s
           join public.daily_schedule_habits sh on sh.user_id = s.user_id and sh.local_date = s.local_date
           where s.user_id = pg_temp.v(6) and s.local_date = '2026-12-02')
          and (select last_streak_date = '2026-12-01' from public.profiles where id = pg_temp.v(5)),
  '(v6''s list is one late joiner on a rest day; v5''s late completion didn''t count the day)');
create temp table sv2 as select * from public.due_streak_savers('2026-12-03 06:00:20+00');
select ok(exists (select 1 from sv2 where user_id = pg_temp.v(3) and local_date = '2026-12-02' and streak = 5),
  '(control: a streak of 5 at risk gets the saver)');
select ok(not exists (select 1 from sv2 where user_id = pg_temp.v(4))
          and not exists (select 1 from public.streak_saver_log where user_id = pg_temp.v(4)),
  'a relived day (before engine_floor_date) gets no saver: it can''t count');
select ok(exists (select 1 from sv2 where user_id = pg_temp.v(5) and streak = 5),
  'completing only a late joiner leaves the streak at risk: the saver is sent');
select ok(not exists (select 1 from sv2 where user_id = pg_temp.v(6)),
  'a day whose only habit joined late is a rest day: no saver');

-- v(7)/v(8): a stored streak of 5 last counted 2026-11-29; 11-30 and 12-01
-- missed (v(8) has the 2 freezes, the maximum, to cover them).
insert into public.habits (id, user_id, title, category, created_at)
select pg_temp.hv(g), pg_temp.v(g), 'Daily', 'mind', '2026-10-01' from generate_series(7, 8) g;
update public.profiles set current_streak = 5, longest_streak = 5, last_streak_date = '2026-11-29',
       streak_run_started = '2026-11-25', streak_freezes = case when id = pg_temp.v(8) then 2 else 0 end
 where id in (pg_temp.v(7), pg_temp.v(8));
-- 20:00 on 2026-12-02 in Kolkata is 14:30 UTC.
create temp table sv3 as select * from public.due_streak_savers('2026-12-02 14:30:20+00');
select ok(not exists (select 1 from sv3 where user_id = pg_temp.v(7)),
  'a stored streak of 5 that get_today judges broken (missed days, no freezes) gets no saver');
select is((select streak from sv3 where user_id = pg_temp.v(8)), 5,
  'with freezes to cover the missed days it''s still at risk, and gets one');

-- ── Streak saver: one user's failure doesn't stop the batch ─────────────────
-- No real per-user state makes get_today_at raise after the pre-filter (it
-- checks the same profile, onboarding and timezone), so inject a fault:
-- v(7)'s snapshot insert fails. v(7) sorts before v(8).
-- Both counted 2026-12-02, so both are at risk on 2026-12-03.
update public.profiles set last_streak_date = '2026-12-02', streak_freezes = 0
 where id in (pg_temp.v(7), pg_temp.v(8));
create function public.test_fail_snapshot() returns trigger language plpgsql as $$
begin raise exception 'injected'; end $$;
create trigger test_fail_snapshot before insert on public.daily_schedule
  for each row when (new.user_id = '70000007-0000-0000-0000-000000000000'::uuid)
  execute function public.test_fail_snapshot();
set local client_min_messages = error;  -- the expected "skipped a user" warning
set local role service_role;
select is((select array_agg(user_id) from public.due_streak_savers('2026-12-03 14:30:20+00')), array[pg_temp.v(8)],
  'a user whose check fails is skipped and the next is still sent (as service_role, the cron''s role)');
reset role;
reset client_min_messages;
select ok(not exists (select 1 from public.streak_saver_log where user_id = pg_temp.v(7) and local_date = '2026-12-03')
          and not exists (select 1 from public.daily_schedule where user_id = pg_temp.v(7) and local_date = '2026-12-03'),
  'and the failed user''s work is rolled back: nothing logged, no partial snapshot');
drop trigger test_fail_snapshot on public.daily_schedule;
select * from finish();
rollback;
