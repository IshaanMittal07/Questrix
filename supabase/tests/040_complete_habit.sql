-- Phase 4 (#68): complete_habit — points, streaks, freezes, milestones.
begin;
create extension if not exists pgtap with schema extensions;
select plan(134);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- A moment k days from now (UTC users), and that day's date / weekday.
create function pg_temp.at(k int) returns timestamptz language sql as $$
  select now() + k * interval '1 day' $$;
create function pg_temp.day(k int) returns date language sql as $$
  select (pg_temp.at(k) at time zone 'UTC')::date $$;
create function pg_temp.dow(k int) returns smallint language sql as $$
  select extract(dow from pg_temp.day(k))::smallint $$;
create function pg_temp.done(p_uid uuid, p_habit uuid, k int) returns jsonb language sql as $$
  select public.complete_habit_at(p_uid, p_habit, pg_temp.at(k)) $$;
create function pg_temp.streak(p_uid uuid) returns int language sql as $$
  select current_streak from public.profiles where id = p_uid $$;
create function pg_temp.balance_ok(p_uid uuid) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = p_uid)
     and (select lifetime_points from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger
          where user_id = p_uid and reason in ('completion', 'streak_milestone', 'undo')) $$;

-- Users (U1..U9); habits are created before onboarding so they don't snapshot.
insert into auth.users (id, email)
select ('1000000' || g || '-0000-0000-0000-000000000000')::uuid, 'u' || g || '@example.com'
from generate_series(1, 9) as g;

insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at) values
  -- U1: points table
  ('a1000000-0000-0000-0000-00000000000e', '10000001-0000-0000-0000-000000000000', 'Easy', 'mind', 'easy', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-00000000000d', '10000001-0000-0000-0000-000000000000', 'Medium', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-00000000000a', '10000001-0000-0000-0000-000000000000', 'Hard', 'mind', 'hard', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  -- U2: consecutive days, milestone, target 3
  ('a2000000-0000-0000-0000-000000000001', '10000002-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('a2000000-0000-0000-0000-000000000003', '10000002-0000-0000-0000-000000000000', 'Water', 'nutrition', 'easy', '{0,1,2,3,4,5,6}', 3, now() - interval '30 days'),
  -- U3: rest day on day 2 (scheduled every weekday but day 2's)
  ('a3000000-0000-0000-0000-000000000001', '10000003-0000-0000-0000-000000000000', 'Not day 2', 'mind', 'medium',
   (select array_agg(d::smallint) from generate_series(0, 6) d where d <> pg_temp.dow(2)), 1, now() - interval '30 days'),
  -- U4: freezes and misses
  ('a4000000-0000-0000-0000-000000000001', '10000004-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  -- U5: edit after a miss (real-time days)
  ('a5000000-0000-0000-0000-000000000001', '10000005-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  -- U6: timezone moves
  ('a6000000-0000-0000-0000-000000000001', '10000006-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 2, now() - interval '30 days'),
  ('a7000000-0000-0000-0000-000000000001', '10000007-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 2, now() - interval '30 days'),
  -- U8: errors and per-habit streaks
  ('a8000000-0000-0000-0000-000000000001', '10000008-0000-0000-0000-000000000000', 'Once', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('a8000000-0000-0000-0000-000000000002', '10000008-0000-0000-0000-000000000000', 'Day 3 only', 'mind', 'medium',
   array[pg_temp.dow(3)], 1, now() - interval '30 days'),
  ('a8000000-0000-0000-0000-000000000003', '10000008-0000-0000-0000-000000000000', 'Archived', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('a8000000-0000-0000-0000-000000000004', '10000008-0000-0000-0000-000000000000', 'Days 1 and 3', 'mind', 'medium',
   array[pg_temp.dow(1), pg_temp.dow(3)], 1, now() - interval '30 days');

-- Extra users (hex ids so they match '1000000%' for the invariants):
-- Ua milestones and the JSON shape, Ub the lookback boundary and freezes,
-- Uc missing snapshot rows, Ud the 20-habit snapshot cap, Ue a mid-day habit.
insert into auth.users (id, email)
select ('1000000' || g || '-0000-0000-0000-000000000000')::uuid, 'u' || g || '@example.com'
from unnest(array['a', 'b', 'c', 'd', 'e']) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at) values
  ('aa000000-0000-0000-0000-000000000001', '1000000a-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('ab000000-0000-0000-0000-000000000001', '1000000b-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('ac000000-0000-0000-0000-000000000001', '1000000c-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('ae000000-0000-0000-0000-000000000001', '1000000e-0000-0000-0000-000000000000', 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days');
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select ('ad000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '1000000d-0000-0000-0000-000000000000',
       'Habit ' || g, 'mind', 'easy', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'
from generate_series(1, 20) as g;

-- Timezones first: changes before onboarding don't start the cooldown.
update public.profiles set timezone = 'Pacific/Kiritimati' where id = '10000006-0000-0000-0000-000000000000';
update public.profiles set timezone = 'Etc/GMT+12' where id = '10000007-0000-0000-0000-000000000000';
update public.profiles set onboarded_at = now() - interval '30 days'
  where id <> '10000009-0000-0000-0000-000000000000'
    and id::text like '1000000%';

-- ── Privileges and structure ────────────────────────────────────────────────
select function_privs_are('public', 'complete_habit', array['uuid'], 'authenticated', array['EXECUTE'],
  'signed-in users can call complete_habit');
select function_privs_are('public', 'complete_habit', array['uuid'], 'anon', array[]::text[],
  'anon cannot call complete_habit');
select function_privs_are('public', 'complete_habit_at', array['uuid', 'uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call the time seam');
select function_privs_are('public', 'complete_habit_at', array['uuid', 'uuid', 'timestamp with time zone'],
  'service_role', array[]::text[], 'nor can service_role');
select ok((select prosrc ~ 'for no key update' from pg_proc
           where oid = 'public.complete_habit_at(uuid, uuid, timestamptz)'::regprocedure),
  'complete_habit_at locks the profile FOR NO KEY UPDATE (serialises concurrent calls, D5)');
select ok((select position('ensure_daily_schedule' in prosrc) < position('for share' in prosrc)
           from pg_proc where oid = 'public.complete_habit_at(uuid, uuid, timestamptz)'::regprocedure),
  'it snapshots before locking the habit row (D5)');
select col_is_unique('public', 'habit_completions', array['habit_id', 'local_date', 'occurrence'],
  'a unique (habit, day, occurrence) backs the lock against duplicate occurrences');
select function_privs_are('public', 'streak_missed_days', array['uuid', 'date', 'date'], 'authenticated',
  array[]::text[], 'clients cannot call streak_missed_days');
select function_privs_are('public', 'streak_missed_days', array['uuid', 'date', 'date'], 'service_role',
  array[]::text[], 'nor can service_role');
select function_privs_are('public', 'habit_missed_days', array['uuid', 'uuid', 'date', 'date'], 'authenticated',
  array[]::text[], 'clients cannot call habit_missed_days');
select isnt_definer('public', 'streak_missed_days', array['uuid', 'date', 'date'],
  'streak_missed_days is SECURITY INVOKER');
select isnt_definer('public', 'habit_missed_days', array['uuid', 'uuid', 'date', 'date'],
  'habit_missed_days is SECURITY INVOKER');
select function_privs_are('public', 'level_for', array['integer'], 'authenticated', array['EXECUTE'],
  'signed-in users can compute levels');
select function_privs_are('public', 'level_for', array['integer'], 'anon', array[]::text[],
  'anon cannot');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc
           where proname in ('complete_habit', 'complete_habit_at', 'streak_missed_days',
                             'habit_missed_days', 'level_for')
             and pronamespace = 'public'::regnamespace),
  'every new function pins an empty search_path');

-- ── Points: floor(base × (1 + 0.01 × min(streak_after_today, 50))) ─────────
create function pg_temp.points_at(p_streak int, k int) returns text language plpgsql as $$
declare
  u uuid := '10000001-0000-0000-0000-000000000000';
  r text := '';
begin
  update public.profiles set current_streak = p_streak - 1, longest_streak = greatest(longest_streak, p_streak),
                             last_streak_date = pg_temp.day(k) - 1
   where id = u;
  -- The day before must exist so it isn't a miss.
  perform public.ensure_daily_schedule(u, pg_temp.at(k - 1));
  r := (pg_temp.done(u, 'a1000000-0000-0000-0000-00000000000e', k) ->> 'points_awarded') || '/'
    || (pg_temp.done(u, 'a1000000-0000-0000-0000-00000000000d', k) ->> 'points_awarded') || '/'
    || (pg_temp.done(u, 'a1000000-0000-0000-0000-00000000000a', k) ->> 'points_awarded');
  return r;
end $$;
select is(pg_temp.points_at(1, 10), '10/20/35', 'streak 1: ×1.01 → 10 / 20 / 35');
select is(pg_temp.points_at(2, 11), '10/20/35', 'streak 2: ×1.02 → 10 / 20 / 35');
select is(pg_temp.points_at(25, 12), '12/25/43', 'streak 25: ×1.25 → 12 / 25 / 43');
select is(pg_temp.points_at(50, 13), '15/30/52', 'streak 50: ×1.50 → 15 / 30 / 52');
select is(pg_temp.points_at(80, 14), '15/30/52', 'streak 80: capped at ×1.50');
select is((select count(*)::int from public.habit_completions
           where user_id = '10000001-0000-0000-0000-000000000000' and multiplier = 1.5), 6,
  'the multiplier is stored as applied');
-- Either side of the cap: 10×1.49 = 14.9, 20×1.49 = 29.8, 35×1.49 = 52.15.
select is(pg_temp.points_at(49, 15), '14/29/52', 'streak 49: ×1.49 → 14 / 29 / 52 (floored)');
select is(pg_temp.points_at(51, 16), '15/30/52', 'streak 51: capped at ×1.50, same as 50');
select is((select array_agg(distinct multiplier order by multiplier) from public.habit_completions
           where user_id = '10000001-0000-0000-0000-000000000000' and local_date in (pg_temp.day(15), pg_temp.day(16))),
  array[1.49, 1.50]::numeric[], 'the stored multipliers are exactly 1.49 and 1.50');
select ok(pg_temp.balance_ok('10000001-0000-0000-0000-000000000000'),
  'balance = ledger sum, lifetime = completions + milestones + undos');

-- ── Streak: consecutive days, milestones once per run ───────────────────────
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 1) ->> 'current_streak')::int, 1,
  'the first completion ever starts a streak at 1');
select is((select streak_run_started from public.profiles where id = '10000002-0000-0000-0000-000000000000'),
  pg_temp.day(1), 'and starts a streak run');
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 2) ->> 'current_streak')::int, 2,
  'the next day increments it');
create temp table r3 as select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 3) as j;
select is((select (j ->> 'current_streak')::int from r3), 3, 'day 3: streak 3');
select is((select (j ->> 'milestone')::int from r3), 3, 'the 3-day milestone is awarded');
select is((select (j ->> 'milestone_points')::int from r3), 25, 'worth 25 points');
select is((select j ->> 'new_balance' from r3)::int,
  (select points_balance from public.profiles where id = '10000002-0000-0000-0000-000000000000'),
  'new_balance reports the balance after the bonus');
select ok((select j ? 'level' and j ? 'multiplier' and j ? 'completion_id' and j ? 'occurrence' from r3),
  'the result carries level, multiplier, completion id and occurrence');
-- A second completion the same day doesn't touch the streak or re-award.
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 3) ->> 'current_streak')::int, 3,
  'later completions the same day leave the streak alone');
select is((select count(*)::int from public.streak_milestones_awarded
           where user_id = '10000002-0000-0000-0000-000000000000'), 1, 'the milestone is awarded once');
select is((select count(*)::int from public.points_ledger
           where user_id = '10000002-0000-0000-0000-000000000000' and reason = 'streak_milestone'), 1,
  'and booked once');
select ok(pg_temp.balance_ok('10000002-0000-0000-0000-000000000000'), 'U2''s ledger balances');

-- Target 3: occurrences 1, 2, 3, then refused.
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 4) ->> 'occurrence')::int, 1,
  'target 3: first occurrence');
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 4) ->> 'occurrence')::int, 2,
  'second occurrence');
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 4) ->> 'occurrence')::int, 3,
  'third occurrence');
select throws_ok($$select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 4)$$,
  'QX103', 'Already done 3 of 3 today', 'completing beyond target_per_day is refused');

-- ── Rest days ───────────────────────────────────────────────────────────────
select pg_temp.done('10000003-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 1);
select is((pg_temp.done('10000003-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 3) ->> 'current_streak')::int, 2,
  'a rest day (nothing scheduled) doesn''t break the streak');
select is((select scheduled_count::int from public.daily_schedule
           where user_id = '10000003-0000-0000-0000-000000000000' and local_date = pg_temp.day(2)), 0,
  '(day 2 really was a rest day)');

-- ── Freezes and real misses ─────────────────────────────────────────────────
update public.profiles set streak_freezes = 1 where id = '10000004-0000-0000-0000-000000000000';
select pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 1);
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 3) ->> 'current_streak')::int, 2,
  'one missed day with one freeze: the streak continues');
select is((select streak_freezes::int from public.profiles where id = '10000004-0000-0000-0000-000000000000'), 0,
  'and the freeze is used');
update public.profiles set streak_freezes = 2 where id = '10000004-0000-0000-0000-000000000000';
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 6) ->> 'current_streak')::int, 3,
  'two missed days with two freezes: continues');
select is((select streak_freezes::int from public.profiles where id = '10000004-0000-0000-0000-000000000000'), 0,
  'both freezes are used');
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 8) ->> 'current_streak')::int, 1,
  'a real miss with no freeze resets the streak to 1');
select is((select streak_run_started from public.profiles where id = '10000004-0000-0000-0000-000000000000'),
  pg_temp.day(8), 'and starts a new run');
select is((select longest_streak from public.profiles where id = '10000004-0000-0000-0000-000000000000'), 3,
  'longest_streak keeps the best run');
update public.profiles set streak_freezes = 2 where id = '10000004-0000-0000-0000-000000000000';
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 9) ->> 'current_streak')::int, 2,
  'continuing the new run');
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 20) ->> 'current_streak')::int, 1,
  'a gap longer than the 7-day lookback breaks the streak even with freezes');
select is((select streak_freezes::int from public.profiles where id = '10000004-0000-0000-0000-000000000000'), 2,
  'and spends no freezes');

-- Milestone again in a new run.
select pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 21);
select is((pg_temp.done('10000004-0000-0000-0000-000000000000', 'a4000000-0000-0000-0000-000000000001', 22) ->> 'milestone')::int, 3,
  'a new run earns the 3-day milestone again');
select ok(pg_temp.balance_ok('10000004-0000-0000-0000-000000000000'), 'U4''s ledger balances');

-- ── Editing or archiving after a missed day doesn't make it a rest day ─────
-- Real time: done 2 days ago, missed yesterday, then today the user drops
-- yesterday's weekday and archives nothing else.
select pg_temp.done('10000005-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000001', -2);
select pg_temp.as_user('10000005-0000-0000-0000-000000000000');
update public.habits set days_of_week = (select array_agg(d::smallint) from generate_series(0, 6) d where d <> pg_temp.dow(-1))
  where id = 'a5000000-0000-0000-0000-000000000001';
select pg_temp.as_postgres();
select is((pg_temp.done('10000005-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000001', 0) ->> 'current_streak')::int, 1,
  'dropping a missed day''s weekday afterwards doesn''t save the streak');

-- ── Timezone moves ──────────────────────────────────────────────────────────
-- West (UTC+14 → UTC-12): completing "yesterday" again doesn't break or
-- double-count the streak (rule 0).
select pg_temp.done('10000006-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000001', -1);
select pg_temp.done('10000006-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000001', 0);
select is(pg_temp.streak('10000006-0000-0000-0000-000000000000'), 2, '(a 2-day streak before the move)');
select pg_temp.as_user('10000006-0000-0000-0000-000000000000');
update public.profiles set timezone = 'Etc/GMT+12' where id = '10000006-0000-0000-0000-000000000000';
select pg_temp.as_postgres();
select is((pg_temp.done('10000006-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000001', 0) ->> 'current_streak')::int, 2,
  'moving west: the streak neither breaks nor double-counts');
select ok((select counted_for_streak from public.daily_progress
           where user_id = '10000006-0000-0000-0000-000000000000'
             and local_date = public.local_date_in('Etc/GMT+12', now())),
  'the west day is marked counted');
select is((select last_streak_date from public.profiles where id = '10000006-0000-0000-0000-000000000000'),
  public.local_date_in('Pacific/Kiritimati', now()), 'nor does last_streak_date go back');

-- East (#28): UTC-12 → UTC+14, completing "tomorrow" minutes later.
select pg_temp.done('10000007-0000-0000-0000-000000000000', 'a7000000-0000-0000-0000-000000000001', 0);
select pg_temp.as_user('10000007-0000-0000-0000-000000000000');
update public.profiles set timezone = 'Pacific/Kiritimati' where id = '10000007-0000-0000-0000-000000000000';
select pg_temp.as_postgres();
select is((pg_temp.done('10000007-0000-0000-0000-000000000000', 'a7000000-0000-0000-0000-000000000001', 0) ->> 'current_streak')::int, 1,
  '#28: a quick flip east can''t produce a second streak increment');
select ok(public.local_date_in('Pacific/Kiritimati', now()) > public.local_date_in('Etc/GMT+12', now()),
  '(the flip really did move the local date forward)');

-- ── Refusals ────────────────────────────────────────────────────────────────
select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 1);
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 1)$$,
  'QX103', null, 'a target-1 habit can''t be done twice in a day');
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000002', 1)$$,
  'QX101', 'This habit isn''t scheduled today', 'an unscheduled habit is refused');
update public.habits set archived_at = now() where id = 'a8000000-0000-0000-0000-000000000003';
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000003', 1)$$,
  'QX102', 'This habit is archived', 'an archived habit is refused');
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 1)$$,
  'P0002', 'Habit not found', 'another user''s habit is "not found"');
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', gen_random_uuid(), 1)$$,
  'P0002', 'Habit not found', 'an unknown habit is "not found"');
select throws_ok($$select public.complete_habit_at(null, 'a8000000-0000-0000-0000-000000000001', now())$$,
  '28000', 'Not signed in', 'no user is refused');
select throws_ok($$select public.complete_habit_at(gen_random_uuid(), 'a8000000-0000-0000-0000-000000000001', now())$$,
  'P0002', 'Profile not found', 'a user with no profile is refused (#70)');
select throws_ok($$select public.complete_habit_at('10000009-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', now())$$,
  'QX107', 'Finish onboarding first', 'a user who hasn''t onboarded is refused');
select is((select count(*)::int from public.habit_completions where user_id = '10000008-0000-0000-0000-000000000000'), 1,
  'refusals leave nothing behind');

-- The public wrapper derives the user from the JWT.
select pg_temp.as_user('10000008-0000-0000-0000-000000000000');
select is((public.complete_habit('a8000000-0000-0000-0000-000000000001') ->> 'occurrence')::int, 1,
  'complete_habit works for the signed-in owner (today)');
select throws_ok($$select public.complete_habit('a2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'and can''t complete someone else''s habit');
select pg_temp.as_anon();
select throws_ok($$select public.complete_habit('a8000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon can''t call it at all');
select pg_temp.as_postgres();

-- ── Per-habit streaks skip unscheduled days ─────────────────────────────────
select is((pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000004', 1) ->> 'habit_streak')::int, 1,
  'per-habit streak starts at 1');
select is((pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000004', 3) ->> 'habit_streak')::int, 2,
  'an unscheduled day in between doesn''t break the per-habit streak');
select is((select longest from public.habit_streaks where habit_id = 'a8000000-0000-0000-0000-000000000004'), 2,
  'per-habit longest follows');
-- Target 3: the per-habit streak advances only when the target is reached.
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 5) ->> 'habit_streak')::int, 1,
  'a target-3 habit''s streak counts days whose target was reached (day 4)');
select is((select last_date from public.habit_streaks where habit_id = 'a2000000-0000-0000-0000-000000000003'), pg_temp.day(4),
  'one of three on day 5 doesn''t advance it yet');
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 5);
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 5) ->> 'habit_streak')::int, 2,
  'the third completion advances it');

-- ── Undo state is recorded ──────────────────────────────────────────────────
select is((select streak_before from public.daily_progress
           where user_id = '10000002-0000-0000-0000-000000000000' and local_date = pg_temp.day(2)), 1,
  'daily_progress keeps the streak before the day counted');
select is((select completed_count from public.daily_progress
           where user_id = '10000002-0000-0000-0000-000000000000' and local_date = pg_temp.day(4)), 3,
  'and counts the day''s completions');
select is((select count(*)::int from public.habit_completions
           where habit_id = 'a2000000-0000-0000-0000-000000000003' and local_date = pg_temp.day(5)
             and habit_current_before = 1 and habit_last_date_before = pg_temp.day(4)), 3,
  'every completion of the day stores the same pre-day habit streak');

-- ── Snapshot values, not live values ────────────────────────────────────────
-- Snapshot day 40 for U8 (medium, target 1), then make the live habit hard
-- with target 3: day 40's completion still uses medium and target 1.
select public.ensure_daily_schedule('10000008-0000-0000-0000-000000000000', pg_temp.at(40));
update public.habits set difficulty = 'hard', target_per_day = 3
  where id = 'a8000000-0000-0000-0000-000000000001';
create temp table d40 as
  select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 40) as j;
select is((select (j ->> 'points_awarded')::int from d40),
  (select floor(20 * (j ->> 'multiplier')::numeric)::int from d40),
  'points use the snapshotted difficulty, not the live one');
select is((select base_points from public.habit_completions
           where habit_id = 'a8000000-0000-0000-0000-000000000001' and local_date = pg_temp.day(40)), 20,
  '(base 20: medium)');
select throws_ok($$select pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 40)$$,
  'QX103', 'Already done 1 of 1 today', 'and the snapshotted target, not the live one');
update public.habits set difficulty = 'hard' where id = 'a8000000-0000-0000-0000-000000000002';
select is((select difficulty::text from public.daily_schedule_habits
           where habit_id = 'a8000000-0000-0000-0000-000000000002' and local_date = pg_temp.day(3)), 'medium',
  'a snapshotted day keeps its difficulty after an edit');

-- ── Every milestone, once per run, and the result's shape (Ua) ─────────────
-- Puts Ua on day k-1 with streak m-1 in one fixed run, then completes day k.
create function pg_temp.reach(m int, k int) returns jsonb language plpgsql as $$
declare
  u uuid := '1000000a-0000-0000-0000-000000000000';
begin
  update public.profiles set current_streak = m - 1, longest_streak = greatest(longest_streak, m - 1),
                             last_streak_date = pg_temp.day(k) - 1, streak_run_started = pg_temp.day(0) - 400
   where id = u;
  perform public.ensure_daily_schedule(u, pg_temp.at(k - 1));
  return pg_temp.done(u, 'aa000000-0000-0000-0000-000000000001', k);
end $$;
-- 7 first, from 0 points: 20×1.07 = 21, + 75 = 96 lifetime → level 2 only
-- with the bonus counted.
create temp table m7 as select pg_temp.reach(7, 40) as j;
select is((select j - 'completion_id' - 'local_date' from m7),
  jsonb_build_object('occurrence', 1, 'target', 1, 'points_awarded', 21, 'multiplier', 1.07,
                     'current_streak', 7, 'habit_streak', 1, 'milestone', 7, 'milestone_points', 75,
                     'new_balance', 96, 'lifetime_points', 96, 'level', 2),
  'streak 7: the 7-day milestone (75) is awarded, and the result counts it in balance, lifetime and level');
select is((select array_agg(k || ':' || jsonb_typeof(j -> k) order by k) from m7, jsonb_object_keys(j) as k),
  array['completion_id:string', 'current_streak:number', 'habit_streak:number', 'level:number',
        'lifetime_points:number', 'local_date:string', 'milestone:number', 'milestone_points:number',
        'multiplier:number', 'new_balance:number', 'occurrence:number', 'points_awarded:number',
        'target:number'],
  'the result has exactly these keys, with these JSON types');
select is((select (j ->> 'local_date')::date from m7), pg_temp.day(40), 'local_date is the completion''s local day');
select ok(exists (select 1 from m7 join public.habit_completions c on c.id = (j ->> 'completion_id')::uuid
                  join public.points_ledger l on l.ref_id = c.id and l.reason = 'completion' and l.delta = 21),
  'completion_id is the stored completion, booked in the ledger');
select is((select (j ->> 'milestone')::int || ':' || (j ->> 'milestone_points') from (select pg_temp.reach(14, 42) as j) x),
  '14:150', 'streak 14: the 14-day milestone (150)');
select is((select string_agg(m || ':' || coalesce(pg_temp.reach(m, 44 + 2 * i::int) ->> 'milestone_points', 'none'), '/' order by i)
           from unnest(array[3, 30, 60, 100, 180, 365]) with ordinality as t(m, i)),
  '3:25/30:400/60:800/100:1500/180:3000/365:5000', 'every other milestone pays its configured bonus');
create temp table m8 as select pg_temp.reach(8, 60) as j;
select is((select jsonb_typeof(j -> 'milestone') || '/' || jsonb_typeof(j -> 'milestone_points') from m8), 'null/null',
  'a non-milestone streak returns milestone and milestone_points as JSON null');
select is((select (pg_temp.reach(7, 62)) -> 'milestone'), 'null'::jsonb,
  'reaching 7 again in the same run awards nothing');
select is((select count(*)::int from public.points_ledger
           where user_id = '1000000a-0000-0000-0000-000000000000' and reason = 'streak_milestone'), 8,
  'one ledger entry per milestone, none for the repeat');
select ok(pg_temp.balance_ok('1000000a-0000-0000-0000-000000000000'), 'Ua''s ledger balances');

-- ── Lookback boundary and freezes (Ub) ──────────────────────────────────────
-- Days 2..8 (a 7-day gap, = streak_lookback_days) are rest days.
select pg_temp.done('1000000b-0000-0000-0000-000000000000', 'ab000000-0000-0000-0000-000000000001', 1);
insert into public.daily_schedule (user_id, local_date, scheduled_count)
select '1000000b-0000-0000-0000-000000000000', pg_temp.day(g), 0 from generate_series(2, 8) as g;
create temp table b9 as select pg_temp.done('1000000b-0000-0000-0000-000000000000', 'ab000000-0000-0000-0000-000000000001', 9) as j;
select is((select (j ->> 'current_streak')::int from b9), 2,
  'a gap of exactly the lookback (7 rest days) keeps the streak');
select is((select (j ->> 'habit_streak')::int from b9), 2, 'and the per-habit streak');
-- Days 10..17: 8 rest days, one past the lookback.
insert into public.daily_schedule (user_id, local_date, scheduled_count)
select '1000000b-0000-0000-0000-000000000000', pg_temp.day(g), 0 from generate_series(10, 17) as g;
update public.profiles set streak_freezes = 2 where id = '1000000b-0000-0000-0000-000000000000';
create temp table b18 as select pg_temp.done('1000000b-0000-0000-0000-000000000000', 'ab000000-0000-0000-0000-000000000001', 18) as j;
select is((select (j ->> 'current_streak')::int from b18), 1,
  'a gap of lookback + 1 days breaks the streak, even when every day was a rest day');
select is((select streak_freezes || '/' || streak_run_started from public.profiles where id = '1000000b-0000-0000-0000-000000000000'),
  '2/' || pg_temp.day(18), 'spends no freezes and starts a new run');
select is((select (j ->> 'habit_streak')::int from b18), 1, 'the per-habit streak resets too');
select is((select current || '/' || longest from public.habit_streaks where habit_id = 'ab000000-0000-0000-0000-000000000001'),
  '1/2', 'habit_streaks.longest keeps the best run after a reset');
-- More missed days than freezes: reset, freezes kept.
update public.profiles set streak_freezes = 1 where id = '1000000b-0000-0000-0000-000000000000';
select pg_temp.done('1000000b-0000-0000-0000-000000000000', 'ab000000-0000-0000-0000-000000000001', 19);
select is((pg_temp.done('1000000b-0000-0000-0000-000000000000', 'ab000000-0000-0000-0000-000000000001', 22) ->> 'current_streak')::int, 1,
  'two missed days with one freeze: the streak resets');
select is((select streak_freezes::int from public.profiles where id = '1000000b-0000-0000-0000-000000000000'), 1,
  'and the freeze isn''t spent');
select is((select longest_streak from public.profiles where id = '1000000b-0000-0000-0000-000000000000'), 2,
  'longest_streak still holds the best run');
select ok(pg_temp.balance_ok('1000000b-0000-0000-0000-000000000000'), 'Ub''s ledger balances');

-- ── A missing snapshot day is missed; a rest-day row isn't (Uc) ─────────────
select pg_temp.done('1000000c-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 1);
select public.ensure_daily_schedule('1000000c-0000-0000-0000-000000000000', pg_temp.at(3));
delete from public.daily_schedule_habits where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(2);
delete from public.daily_schedule where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(2);
create temp table c3 as select pg_temp.done('1000000c-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 3) as j;
select is((select (j ->> 'current_streak')::int from c3), 1, 'a day with no snapshot row counts as missed (fail closed)');
select is((select (j ->> 'habit_streak')::int from c3), 1, 'for the per-habit streak too');
select pg_temp.done('1000000c-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 4);
select public.ensure_daily_schedule('1000000c-0000-0000-0000-000000000000', pg_temp.at(6));
delete from public.daily_schedule_habits where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(5);
update public.daily_schedule set scheduled_count = 0
 where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(5);
create temp table c6 as select pg_temp.done('1000000c-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 6) as j;
select is((select (j ->> 'current_streak')::int from c6), 3, 'whereas a rest-day row doesn''t break the streak');
select is((select (j ->> 'habit_streak')::int from c6), 3, 'nor the per-habit streak');
-- With a freeze, a missing day spends it.
update public.profiles set streak_freezes = 1 where id = '1000000c-0000-0000-0000-000000000000';
select public.ensure_daily_schedule('1000000c-0000-0000-0000-000000000000', pg_temp.at(8));
delete from public.daily_schedule_habits where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(7);
delete from public.daily_schedule where user_id = '1000000c-0000-0000-0000-000000000000' and local_date = pg_temp.day(7);
-- (Separate statements: a subquery in the same statement would read the
-- profile as of the statement's start.)
create temp table c8 as select pg_temp.done('1000000c-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 8) as j;
select is((select (j ->> 'current_streak') from c8)
          || '/' || (select streak_freezes from public.profiles where id = '1000000c-0000-0000-0000-000000000000'),
  '4/0', 'a missing day is covered by a freeze, which is spent');

-- ── Habits added mid-day: under the cap they count, past it they don't ─────
-- Ue: today's snapshot exists, then a new habit joins it as an extra.
select public.ensure_daily_schedule('1000000e-0000-0000-0000-000000000000', now());
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day)
values ('ae000000-0000-0000-0000-000000000002', '1000000e-0000-0000-0000-000000000000', 'New', 'mind', 'hard', '{0,1,2,3,4,5,6}', 1);
select is((pg_temp.done('1000000e-0000-0000-0000-000000000000', 'ae000000-0000-0000-0000-000000000002', 0) ->> 'points_awarded')::int, 35,
  'a habit created mid-day joins today''s snapshot and can be completed');
select is((select scheduled_count::int from public.daily_schedule
           where user_id = '1000000e-0000-0000-0000-000000000000' and local_date = pg_temp.day(0)), 1,
  '(as an extra: scheduled_count is unchanged)');
-- Ud: today's snapshot is full (20); archive one, add one.
select public.ensure_daily_schedule('1000000d-0000-0000-0000-000000000000', now());
update public.habits set archived_at = now() where id = 'ad000000-0000-0000-0000-000000000001';
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day)
values ('ad000000-0000-0000-0000-000000000021', '1000000d-0000-0000-0000-000000000000', 'Late', 'mind', 'easy', '{0,1,2,3,4,5,6}', 1);
select throws_ok($$select pg_temp.done('1000000d-0000-0000-0000-000000000000', 'ad000000-0000-0000-0000-000000000021', 0)$$,
  'QX101', 'This habit isn''t scheduled today', 'a habit added past the 20-habit snapshot cap can''t be completed today');
select is((select count(*)::int from public.daily_schedule_habits
           where user_id = '1000000d-0000-0000-0000-000000000000' and local_date = pg_temp.day(0)), 20,
  '(today''s snapshot stayed at 20)');
select is((pg_temp.done('1000000d-0000-0000-0000-000000000000', 'ad000000-0000-0000-0000-000000000021', 1) ->> 'occurrence')::int, 1,
  'it can be completed from the next day');

-- ── service_role can't complete habits ──────────────────────────────────────
select function_privs_are('public', 'complete_habit', array['uuid'], 'service_role', array[]::text[],
  'service_role has no EXECUTE on complete_habit');
select set_config('role', 'service_role', true);
select throws_ok($$select public.complete_habit('a8000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'service_role calling complete_habit is refused');
select throws_ok($$select public.complete_habit_at('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', now() + interval '2 days')$$,
  '42501', null, 'and so is the time seam');
select pg_temp.as_postgres();

-- ── Invariants for everyone ─────────────────────────────────────────────────
select ok(bool_and(pg_temp.balance_ok(id)), 'every user''s balance and lifetime match the ledger')
from public.profiles where id::text like '1000000%';
select ok(not exists (select 1 from public.habit_completions where points_awarded <> floor(base_points * multiplier)),
  'every award follows the formula');
select is(public.level_for(0), 1, 'level 1 at 0 points');
select is(public.level_for(50), 2, 'level 2 at 50');
select is(public.level_for(800), 5, 'level 5 at 800');

-- ── Undo before-values (what #69 restores) ──────────────────────────────────
select is((select streak_freezes_before::int from public.daily_progress
           where user_id = '10000004-0000-0000-0000-000000000000' and local_date = pg_temp.day(3)), 1,
  'a freeze day records the freezes before');
select ok((select streak_before = 3 and longest_streak_before = 3 and last_streak_date_before = pg_temp.day(6)
                  and streak_freezes_before = 0 and streak_run_started_before = pg_temp.day(1)
           from public.daily_progress
           where user_id = '10000004-0000-0000-0000-000000000000' and local_date = pg_temp.day(8)),
  'a reset day records the whole streak state before it');
select ok((select streak_before = 0 and longest_streak_before = 0 and last_streak_date_before is null
                  and streak_run_started_before is null
           from public.daily_progress
           where user_id = '10000002-0000-0000-0000-000000000000' and local_date = pg_temp.day(1)),
  'the first-ever day records the empty state');
select ok((select habit_current_before is null and habit_longest_before is null and habit_last_date_before is null
           from public.habit_completions
           where habit_id = 'a2000000-0000-0000-0000-000000000001' and local_date = pg_temp.day(1)),
  'a habit''s first completion records no prior habit streak');

-- The overwrite path #69 relies on: an undo that empties a day restores the
-- profile and clears counted_for_streak; the next completion records the
-- restored state as the day's before-state.
create temp table ow as select * from public.profiles where id = '10000002-0000-0000-0000-000000000000';
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 30);
update public.profiles p
   set current_streak = ow.current_streak, longest_streak = ow.longest_streak,
       last_streak_date = ow.last_streak_date, streak_freezes = ow.streak_freezes,
       streak_run_started = ow.streak_run_started
  from ow where p.id = ow.id;
update public.daily_progress set counted_for_streak = false
  where user_id = '10000002-0000-0000-0000-000000000000' and local_date = pg_temp.day(30);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 30);
select ok((select d.streak_before = ow.current_streak and d.last_streak_date_before = ow.last_streak_date
                  and d.streak_run_started_before = ow.streak_run_started
           from public.daily_progress d, ow
           where d.user_id = ow.id and d.local_date = pg_temp.day(30)),
  'a second first-completion rewrites the before-state from the restored profile');

-- ── Per-habit resets ────────────────────────────────────────────────────────
-- Scheduled on day 1's and day 3's weekdays; day 8 (= day 1's) is missed.
select is((pg_temp.done('10000008-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000004', 10) ->> 'habit_streak')::int, 1,
  'a per-habit streak resets after a scheduled day was missed');
-- Target 3: reached on day 31, only 2 of 3 on day 32, reached on day 33.
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 31);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 31);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 31);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 32);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 32);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 33);
select pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 33);
select is((pg_temp.done('10000002-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000003', 33) ->> 'habit_streak')::int, 1,
  'a day short of the target (2 of 3) breaks the per-habit streak');

-- ── Archiving after a missed day doesn't make it a rest day ─────────────────
insert into auth.users (id, email) values ('1000000f-0000-0000-0000-000000000000', 'uf@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('af000000-0000-0000-0000-000000000001', '1000000f-0000-0000-0000-000000000000', 'Kept', 'mind', now() - interval '30 days'),
  ('af000000-0000-0000-0000-000000000002', '1000000f-0000-0000-0000-000000000000', 'Dropped', 'mind', now() - interval '30 days');
update public.habits set days_of_week = array[pg_temp.dow(-1)]
  where id = 'af000000-0000-0000-0000-000000000002';
update public.habits set days_of_week = (select array_agg(d::smallint) from generate_series(0, 6) d where d <> pg_temp.dow(-1))
  where id = 'af000000-0000-0000-0000-000000000001';
update public.profiles set onboarded_at = now() - interval '30 days'
  where id = '1000000f-0000-0000-0000-000000000000';
select pg_temp.done('1000000f-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-000000000001', -2);
select pg_temp.as_user('1000000f-0000-0000-0000-000000000000');
select public.archive_habit('af000000-0000-0000-0000-000000000002');
select pg_temp.as_postgres();
select is((pg_temp.done('1000000f-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-000000000001', 0) ->> 'current_streak')::int, 1,
  'archiving yesterday''s only habit afterwards doesn''t turn the missed day into a rest day');

select lives_ok($$set constraints all immediate$$, 'deferred FKs hold');
select * from finish();
rollback;
