-- Phase 4: game-engine tables — RLS, privileges, keys, config (#66).
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

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

-- ── Policies: exactly one owner-read policy per table, nothing else ────────
select policies_are('public', 'daily_schedule', array['daily_schedule: owner can read'],
  'daily_schedule has only the owner-read policy');
select policies_are('public', 'daily_schedule_habits', array['daily_schedule_habits: owner can read'],
  'daily_schedule_habits has only the owner-read policy');
select policies_are('public', 'habit_completions', array['habit_completions: owner can read'],
  'habit_completions has only the owner-read policy');
select policies_are('public', 'daily_progress', array['daily_progress: owner can read'],
  'daily_progress has only the owner-read policy');
select policies_are('public', 'points_ledger', array['points_ledger: owner can read'],
  'points_ledger has only the owner-read policy');
select policies_are('public', 'habit_streaks', array['habit_streaks: owner can read'],
  'habit_streaks has only the owner-read policy');
select policies_are('public', 'streak_milestones_awarded', array['streak_milestones_awarded: owner can read'],
  'streak_milestones_awarded has only the owner-read policy');
select policies_are('public', 'economy_config', array['economy_config: readable by signed-in users'],
  'economy_config has only the signed-in read policy');
select is((select count(*)::int from pg_policies
           where schemaname = 'public'
             and tablename in (select name from engine_tables union all select 'economy_config')
             and (cmd <> 'SELECT' or roles <> array['authenticated']::name[] or permissive <> 'PERMISSIVE')),
  0, 'every engine policy is a permissive SELECT for authenticated only');

-- ── economy_value: internal, definer, pinned search_path ────────────────────
select function_privs_are('public', 'economy_value', array['text'], 'anon', array[]::text[],
  'anon cannot execute economy_value');
select function_privs_are('public', 'economy_value', array['text'], 'authenticated', array[]::text[],
  'authenticated cannot execute economy_value');
select isnt_definer('public', 'economy_value', array['text'],
  'economy_value is SECURITY INVOKER (only definer functions call it)');
select function_privs_are('public', 'economy_value', array['text'], 'service_role', array[]::text[],
  'service_role cannot execute economy_value either');
select is((select proconfig from pg_proc where oid = 'public.economy_value(text)'::regprocedure),
  array['search_path=""'], 'economy_value pins search_path to empty');

-- ── Ledger identity and undo-state columns ──────────────────────────────────
select is((select attidentity::text from pg_attribute
           where attrelid = 'public.points_ledger'::regclass and attname = 'id'), 'a',
  'points_ledger.id is GENERATED ALWAYS (ids cannot be chosen)');
select col_is_null('public', 'daily_progress', 'streak_before', 'daily_progress.streak_before is nullable');
select col_is_null('public', 'daily_progress', 'last_streak_date_before', 'daily_progress.last_streak_date_before is nullable');
select col_is_null('public', 'daily_progress', 'streak_freezes_before', 'daily_progress.streak_freezes_before is nullable');
select col_is_null('public', 'daily_progress', 'streak_run_started_before', 'daily_progress.streak_run_started_before is nullable');
select col_is_null('public', 'habit_completions', 'habit_current_before', 'habit_completions.habit_current_before is nullable');
select col_is_null('public', 'habit_completions', 'habit_last_date_before', 'habit_completions.habit_last_date_before is nullable');

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

select throws_ok($$insert into public.points_ledger (id, user_id, delta, reason) overriding system value
  values (1, '11111111-1111-1111-1111-111111111111', 5000, 'admin_adjust')$$, '42501', null,
  'Alice cannot write a ledger row with a chosen id');

-- ── Bob cannot read Alice's rows even by key ────────────────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.habit_completions
           where id = 'cccccccc-0000-0000-0000-00000000000a'), 0,
  'Bob cannot read Alice''s completion by id');
select is((select count(*)::int from public.habit_streaks
           where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'Bob cannot read Alice''s habit streak by habit id');
select is((select count(*)::int from public.daily_schedule_habits
           where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'Bob cannot read Alice''s schedule snapshot by habit id');
select is((select count(*)::int from public.daily_schedule
           where user_id = '11111111-1111-1111-1111-111111111111' and local_date = '2026-11-16'), 0,
  'Bob cannot read Alice''s daily_schedule by key');
select is((select count(*)::int from public.daily_progress
           where user_id = '11111111-1111-1111-1111-111111111111' and local_date = '2026-11-16'), 0,
  'Bob cannot read Alice''s daily_progress by key');
select is((select count(*)::int from public.points_ledger
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'Bob cannot read Alice''s ledger');
select is((select count(*)::int from public.streak_milestones_awarded
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'Bob cannot read Alice''s milestones');

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
select throws_ok($$update public.daily_schedule set scheduled_count = -1$$, '23514', null,
  'scheduled_count is never negative');
select throws_ok($$delete from public.daily_schedule
  where user_id = '11111111-1111-1111-1111-111111111111' and local_date = '2026-11-16'$$, '23503', null,
  'deleting a day that has a snapshot fails loudly (no cascade)');
select throws_ok($$delete from public.daily_schedule_habits
  where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '23503', null,
  'deleting a snapshot entry that has completions fails loudly (no cascade)');
select throws_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 2, 35, 1.5, 53)$$,
  '23514', null, 'points_awarded must equal floor(base × multiplier)');
select lives_ok($$insert into public.habit_completions (habit_id, user_id, local_date, occurrence, base_points, multiplier, points_awarded, habit_longest_before)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-16', 2, 35, 1.5, 52, null)$$,
  'a correct award is accepted (floor(35 × 1.5) = 52)');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', -5, 'completion')$$, '23514', null,
  'a completion entry is positive');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', 5, 'undo')$$, '23514', null,
  'an undo entry is negative');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', 5, 'purchase')$$, '23514', null,
  'a purchase entry is negative');
select lives_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', -5, 'admin_adjust')$$,
  'an admin adjustment can go either way');
select lives_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('11111111-1111-1111-1111-111111111111', 20, 'completion', 'cccccccc-0000-0000-0000-00000000000a')$$,
  'a completion is booked with its id');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('11111111-1111-1111-1111-111111111111', 20, 'completion', 'cccccccc-0000-0000-0000-00000000000a')$$,
  '23505', null, 'the same completion can''t be booked twice');
select lives_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('11111111-1111-1111-1111-111111111111', -20, 'undo', 'cccccccc-0000-0000-0000-00000000000a')$$,
  'its undo is booked once');
select throws_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('11111111-1111-1111-1111-111111111111', -20, 'undo', 'cccccccc-0000-0000-0000-00000000000a')$$,
  '23505', null, 'and can''t be booked twice');
select ok((select id is not null from public.streak_milestones_awarded limit 1),
  'milestones have an id for their ledger entries');
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
select throws_ok($$insert into public.points_ledger (id, user_id, delta, reason)
  values (999999, '11111111-1111-1111-1111-111111111111', 5, 'completion')$$, '428C9', null,
  'even the owner cannot pick a ledger id without OVERRIDING SYSTEM VALUE');
select lives_ok($$insert into public.daily_progress
  (user_id, local_date, completed_count, counted_for_streak,
   streak_before, last_streak_date_before, streak_freezes_before, streak_run_started_before)
  values ('11111111-1111-1111-1111-111111111111', '2026-11-19', 1, true, null, null, null, null)$$,
  'a first-ever day stores null *_before undo state');

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

-- ── Ledger append-only, sequence locked ─────────────────────────────────────
select sequence_privs_are('public', 'points_ledger_id_seq', 'authenticated', array[]::text[],
  'authenticated has no privileges on the ledger id sequence');
select sequence_privs_are('public', 'points_ledger_id_seq', 'anon', array[]::text[],
  'anon has no privileges on the ledger id sequence');
select table_privs_are('public', 'points_ledger', 'service_role', array['INSERT', 'REFERENCES', 'SELECT', 'TRIGGER'],
  'service_role can append to the ledger but not edit, delete or truncate it');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select throws_ok($$select setval('public.points_ledger_id_seq', 1)$$, '42501', null,
  'a signed-in user cannot reset the ledger id sequence');
select pg_temp.as_postgres();

-- ── economy_config.updated_at follows edits ─────────────────────────────────
update public.economy_config set updated_at = '2000-01-01' where key = 'multiplier_cap';
update public.economy_config set value = '50' where key = 'multiplier_cap';
select ok((select updated_at > '2001-01-01' from public.economy_config where key = 'multiplier_cap'),
  'updating a config value stamps updated_at');

-- ── Cascade: deleting a habit removes its engine rows, not the day ─────────
delete from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.habit_completions
           where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'completions go with the habit');
select is((select count(*)::int from public.daily_schedule_habits
           where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'snapshot entries go with the habit');
select is((select count(*)::int from public.habit_streaks
           where habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'the habit streak goes with the habit');
select is((select count(*)::int from public.daily_schedule
           where user_id = '11111111-1111-1111-1111-111111111111' and local_date = '2026-11-16'), 1,
  'the day''s schedule row survives a habit delete');
select is((select count(*)::int from public.points_ledger
           where user_id = '11111111-1111-1111-1111-111111111111'), 4,
  'ledger rows survive a habit delete (append-only)');

-- ── Cascade: deleting a user removes all of their engine rows ───────────────
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.daily_schedule
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'schedule days go with the user');
select is((select count(*)::int from public.daily_progress
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'daily_progress goes with the user');
select is((select count(*)::int from public.habit_streaks
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'habit streaks go with the user');
select is((select count(*)::int from public.streak_milestones_awarded
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'milestones go with the user');
select is((select count(*)::int from public.habit_completions
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'completions go with the user');
select is((select count(*)::int from public.points_ledger
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'ledger rows go with the user');
select is((select count(*)::int from public.daily_schedule_habits
           where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'snapshots go with the user');

select * from finish();
rollback;
