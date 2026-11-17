-- Phase 4: game-engine tables — RLS, privileges, keys, config (#66).
begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

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

-- Alice (a1) and Bob (b1), each with one habit and one scheduled day.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Meditate', 'mind'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Read', 'learning');

insert into public.daily_schedule (user_id, local_date, scheduled_count) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-16', 1),
  ('22222222-2222-2222-2222-222222222222', '2026-11-16', 1);
insert into public.daily_schedule_habits (user_id, local_date, habit_id, difficulty, target_per_day) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-16', 'aaaaaaaa-0000-0000-0000-000000000001', 'medium', 2),
  ('22222222-2222-2222-2222-222222222222', '2026-11-16', 'bbbbbbbb-0000-0000-0000-000000000001', 'easy', 1);
insert into public.habit_completions
  (id, habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded) values
  ('cccccccc-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '2026-11-16', 1, 20, 1.01, 20),
  ('cccccccc-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', '2026-11-16', 1, 10, 1.01, 10);
insert into public.daily_progress (user_id, local_date, completed_count, counted_for_streak) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-16', 1, true),
  ('22222222-2222-2222-2222-222222222222', '2026-11-16', 1, true);
insert into public.points_ledger (user_id, delta, reason) values
  ('11111111-1111-1111-1111-111111111111', 20, 'completion'),
  ('22222222-2222-2222-2222-222222222222', 10, 'completion');
insert into public.habit_streaks (habit_id, user_id, current, longest, last_date) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 1, '2026-11-16'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1, 1, '2026-11-16');
insert into public.streak_milestones_awarded (user_id, streak_run_started, milestone, points, awarded_on) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-14', 3, 25, '2026-11-16'),
  ('22222222-2222-2222-2222-222222222222', '2026-11-14', 3, 25, '2026-11-16');

-- ── RLS on, select-only grants ──────────────────────────────────────────────
create temp table engine_tables (name text);
insert into engine_tables values
  ('daily_schedule'), ('daily_schedule_habits'), ('habit_completions'),
  ('daily_progress'), ('points_ledger'), ('habit_streaks'), ('streak_milestones_awarded');
grant select on engine_tables to authenticated, anon;

select ok((select relrowsecurity from pg_class where oid = ('public.' || name)::regclass),
  'RLS is enabled on ' || name) from engine_tables order by name;
select ok((select relrowsecurity from pg_class where oid = 'public.economy_config'::regclass),
  'RLS is enabled on economy_config');

select table_privs_are('public', name, 'authenticated', array['SELECT'],
  'authenticated can only SELECT ' || name) from engine_tables order by name;
select table_privs_are('public', name, 'anon', array[]::text[],
  'anon has no privileges on ' || name) from engine_tables order by name;
select table_privs_are('public', 'economy_config', 'authenticated', array['SELECT'],
  'authenticated can only SELECT economy_config');
select table_privs_are('public', 'economy_config', 'anon', array[]::text[],
  'anon has no privileges on economy_config');

-- ── Read isolation ──────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.daily_schedule), 1, 'Alice sees only her daily_schedule');
select is((select count(*)::int from public.daily_schedule_habits), 1, 'Alice sees only her schedule habits');
select is((select count(*)::int from public.habit_completions), 1, 'Alice sees only her completions');
select is((select count(*)::int from public.daily_progress), 1, 'Alice sees only her daily_progress');
select is((select count(*)::int from public.points_ledger), 1, 'Alice sees only her ledger');
select is((select count(*)::int from public.habit_streaks), 1, 'Alice sees only her habit streaks');
select is((select count(*)::int from public.streak_milestones_awarded), 1, 'Alice sees only her milestones');
select is((select count(*)::int from public.habit_completions
           where user_id = '22222222-2222-2222-2222-222222222222'), 0,
  'Alice cannot read Bob''s completions even by asking');
select ok((select count(*) from public.economy_config) >= 10, 'signed-in users can read economy_config');

-- ── No client writes (as Alice, on her own rows) ────────────────────────────
select throws_ok($$insert into public.daily_schedule (user_id, local_date)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-17')$$, '42501', null,
  'Alice cannot insert a daily_schedule row');
select throws_ok($$update public.daily_schedule set scheduled_count = 0$$, '42501', null,
  'Alice cannot rewrite her daily_schedule');
select throws_ok($$delete from public.daily_schedule$$, '42501', null,
  'Alice cannot delete her daily_schedule');
select throws_ok($$insert into public.daily_schedule_habits (user_id, local_date, habit_id, difficulty, target_per_day)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-16', 'aaaaaaaa-0000-0000-0000-000000000001', 'hard', 5)$$,
  '42501', null, 'Alice cannot add to a schedule snapshot');
select throws_ok($$update public.daily_schedule_habits set difficulty = 'hard'$$, '42501', null,
  'Alice cannot change a snapshotted difficulty');
select throws_ok($$delete from public.daily_schedule_habits$$, '42501', null,
  'Alice cannot remove a habit from a snapshot');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 2, 35, 1.5, 1000)$$,
  '42501', null, 'Alice cannot forge a completion');
select throws_ok($$update public.habit_completions set points_awarded = 1000$$, '42501', null,
  'Alice cannot inflate points_awarded');
select throws_ok($$delete from public.habit_completions$$, '42501', null,
  'Alice cannot delete completions directly (undo is an RPC)');
select throws_ok($$insert into public.daily_progress (user_id, local_date)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-17')$$, '42501', null,
  'Alice cannot insert daily_progress');
select throws_ok($$update public.daily_progress set streak_before = 999$$, '42501', null,
  'Alice cannot tamper with undo state');
select throws_ok($$delete from public.daily_progress$$, '42501', null,
  'Alice cannot delete daily_progress');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', 5000, 'admin_adjust')$$, '42501', null,
  'Alice cannot write to the ledger');
select throws_ok($$update public.points_ledger set delta = 5000$$, '42501', null,
  'Alice cannot edit ledger entries');
select throws_ok($$delete from public.points_ledger$$, '42501', null,
  'Alice cannot delete ledger entries');
select throws_ok($$insert into public.habit_streaks (habit_id, user_id, current, longest)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 99, 99)$$,
  '42501', null, 'Alice cannot insert a habit streak');
select throws_ok($$update public.habit_streaks set current = 99, longest = 99$$, '42501', null,
  'Alice cannot inflate a habit streak');
select throws_ok($$delete from public.habit_streaks$$, '42501', null,
  'Alice cannot delete habit streaks');
select throws_ok($$insert into public.streak_milestones_awarded (user_id, streak_run_started, milestone, points, awarded_on)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-14', 7, 75, '2026-11-16')$$,
  '42501', null, 'Alice cannot award herself a milestone');
select throws_ok($$delete from public.streak_milestones_awarded$$, '42501', null,
  'Alice cannot clear milestones to re-earn them');
select throws_ok($$update public.economy_config set value = '1000' where key = 'multiplier_cap'$$,
  '42501', null, 'Alice cannot tune the economy');
select throws_ok($$insert into public.economy_config (key, value) values ('x_key', '1')$$,
  '42501', null, 'Alice cannot add config keys');
select throws_ok($$select public.economy_value('base_points')$$, '42501', null,
  'clients cannot call the internal config getter');

-- ── Anon sees nothing ───────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$select 1 from public.habit_completions$$, '42501', null,
  'anon cannot read completions');
select throws_ok($$select 1 from public.points_ledger$$, '42501', null,
  'anon cannot read the ledger');
select throws_ok($$select 1 from public.economy_config$$, '42501', null,
  'anon cannot read economy_config');

-- ── Keys and constraints (as postgres, the functions' owner) ────────────────
select pg_temp.as_postgres();
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-11-16', 2, 20, 1.01, 20)$$,
  '23503', null, 'a completion must belong to the habit''s owner (composite FK)');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-17', 1, 20, 1.01, 20)$$,
  '23503', null, 'a completion needs the habit in that day''s schedule snapshot');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 1, 20, 1.01, 20)$$,
  '23505', null, 'an occurrence can be used once per habit per day');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 6, 20, 1.01, 20)$$,
  '23514', null, 'occurrence is 1..5');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 2, 20, 0.5, 20)$$,
  '23514', null, 'the multiplier is at least 1');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 2, 20, 1.01, -1)$$,
  '23514', null, 'points_awarded is never negative');
select throws_ok($$insert into public.daily_schedule_habits (user_id, local_date, habit_id, difficulty, target_per_day)
  values ('22222222-2222-2222-2222-222222222222', '2026-11-16', 'aaaaaaaa-0000-0000-0000-000000000001', 'easy', 1)$$,
  '23503', null, 'a snapshot can only hold the user''s own habits');
select throws_ok($$insert into public.daily_schedule_habits (user_id, local_date, habit_id, difficulty, target_per_day)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-20', 'aaaaaaaa-0000-0000-0000-000000000001', 'easy', 1)$$,
  '23503', null, 'a snapshot habit needs its day row');
select throws_ok($$insert into public.daily_schedule_habits (user_id, local_date, habit_id, difficulty, target_per_day)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-16', 'aaaaaaaa-0000-0000-0000-000000000001', 'easy', 6)$$,
  '23514', null, 'a snapshotted target is 1..5');
select throws_ok($$update public.daily_schedule set scheduled_count = 21$$, '23514', null,
  'a day holds at most 20 scheduled habits');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', 0, 'completion')$$, '23514', null,
  'ledger entries are never zero');
select throws_ok($$update public.habit_streaks set current = 5, longest = 2$$, '23514', null,
  'longest is never below current');
select throws_ok($$update public.habit_streaks set current = -1$$, '23514', null,
  'a habit streak is never negative');
select throws_ok($$insert into public.streak_milestones_awarded (user_id, streak_run_started, milestone, points, awarded_on)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-14', 3, 25, '2026-11-17')$$, '23505', null,
  'a milestone is awarded once per streak run');
select lives_ok($$insert into public.streak_milestones_awarded (user_id, streak_run_started, milestone, points, awarded_on)
  values ('11111111-1111-1111-1111-111111111111', '2026-12-01', 3, 25, '2026-12-03')$$,
  'the same milestone can be earned again in a new run');
select throws_ok($$insert into public.daily_progress (user_id, local_date, completed_count)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-18', -1)$$, '23514', null,
  'completed_count is never negative');
select throws_ok($$insert into public.economy_config (key, value) values ('Bad Key', '1')$$, '23514', null,
  'config keys are lowercase slugs');

-- ── Config ──────────────────────────────────────────────────────────────────
select is(public.economy_value('base_points'), '{"easy": 10, "medium": 20, "hard": 35}'::jsonb,
  'base points match plan §6.1');
select is(public.economy_value('multiplier_step')::numeric, 0.01, 'multiplier step is 0.01');
select is(public.economy_value('multiplier_cap')::int, 50, 'multiplier caps at a 50-day streak');
select is(public.economy_value('milestones') ->> '365', '5000', 'the 365-day milestone is 5,000');
select is((select count(*)::int from jsonb_object_keys(public.economy_value('milestones'))), 8,
  'all 8 milestones are configured');
select is(public.economy_value('undo_window_minutes')::int, 15, 'undo window is 15 minutes');
select is(public.economy_value('streak_lookback_days')::int, 7, 'streak lookback is 7 days');
select is(public.economy_value('streak_freezes_max')::int, 2, 'at most 2 freezes');
select is(public.economy_value('schedule_max_habits')::int, 20, 'a day snapshots at most 20 habits');
select is(public.economy_value('habit_create_limits'), '{"per_day": 30, "per_30_days": 100}'::jsonb,
  'habit creation limits');
select is(public.economy_value('timezone_change_cooldown_days')::int, 7, 'timezone cooldown is 7 days');
select throws_ok($$select public.economy_value('nope')$$, 'P0002', 'Missing economy_config key: nope',
  'a missing config key raises');

-- ── Cascade: deleting a user removes all of their engine rows ───────────────
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.habit_completions
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'completions go with the user');
select is((select count(*)::int from public.points_ledger
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'ledger rows go with the user');
select is((select count(*)::int from public.daily_schedule_habits
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'snapshots go with the user');

select * from finish();
rollback;
