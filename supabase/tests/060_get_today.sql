-- Phase 4 (#70): get_today — today's snapshot, progress, effective streaks,
-- at_risk (D7) and the SQL side of the level parity test.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Noon UTC k days from today, plus m minutes (all users are UTC).
create function pg_temp.t(k int, m numeric default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + k * interval '1 day' + interval '12 hours' + m * interval '1 minute' $$;
create function pg_temp.day(k int) returns date language sql as $$
  select (pg_temp.t(k) at time zone 'UTC')::date $$;
create function pg_temp.dow(k int) returns smallint language sql as $$
  select extract(dow from pg_temp.day(k))::smallint $$;
create function pg_temp.today(p_uid uuid, k int, m numeric default 0) returns jsonb language sql as $$
  select public.get_today_at(p_uid, pg_temp.t(k, m)) $$;
create function pg_temp.done(p_uid uuid, p_habit uuid, k int, m numeric default 0) returns jsonb language sql as $$
  select public.complete_habit_at(p_uid, p_habit, pg_temp.t(k, m)) $$;
create function pg_temp.habit(j jsonb, p_title text) returns jsonb language sql as $$
  select h from jsonb_array_elements(j -> 'habits') h where h ->> 'title' = p_title $$;
create function pg_temp.titles(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(h ->> 'title' order by o), '{}')
  from jsonb_array_elements(j -> 'habits') with ordinality as e(h, o) $$;

-- G1 the list · G2 a broken streak · G3 a freeze · G4 past the lookback ·
-- G5 a rest day · G6 at_risk · G7 no streak yet · G9 not onboarded.
insert into auth.users (id, email)
select ('3000000' || g || '-0000-0000-0000-000000000000')::uuid, 'today' || g || '@example.com'
from generate_series(1, 9) as g;
-- G1: B first so it sorts first; C isn't scheduled on day 1; D is archived later.
insert into public.habits (id, user_id, title, category, difficulty, target_per_day, created_at) values
  ('e1000000-0000-0000-0000-00000000000b', '30000001-0000-0000-0000-000000000000', 'B', 'nutrition', 'easy', 3, now() - interval '30 days');
insert into public.habits (id, user_id, title, category, difficulty, icon, color, created_at) values
  ('e1000000-0000-0000-0000-00000000000a', '30000001-0000-0000-0000-000000000000', 'A', 'mind', 'medium', 'book', 'violet', now() - interval '30 days');
insert into public.habits (id, user_id, title, category, days_of_week, created_at) values
  ('e1000000-0000-0000-0000-00000000000c', '30000001-0000-0000-0000-000000000000', 'C', 'mind',
   (select array_agg(d::smallint) from generate_series(0, 6) d where d <> pg_temp.dow(1)), now() - interval '30 days');
insert into public.habits (id, user_id, title, category, created_at) values
  ('e1000000-0000-0000-0000-00000000000d', '30000001-0000-0000-0000-000000000000', 'D', 'mind', now() - interval '30 days');
insert into public.habits (id, user_id, title, category, created_at)
select ('e' || g || '000000-0000-0000-0000-000000000001')::uuid,
       ('3000000' || g || '-0000-0000-0000-000000000000')::uuid, 'Daily', 'mind', now() - interval '30 days'
from generate_series(2, 7) as g
where g <> 5;
insert into public.habits (id, user_id, title, category, days_of_week, created_at) values
  ('e5000000-0000-0000-0000-000000000001', '30000005-0000-0000-0000-000000000000', 'Not day 2', 'mind',
   (select array_agg(d::smallint) from generate_series(0, 6) d where d <> pg_temp.dow(2)), now() - interval '30 days');
update public.profiles set onboarded_at = now() - interval '30 days'
  where id::text like '3000000%' and id <> '30000009-0000-0000-0000-000000000000';
update public.profiles set streak_freezes = 1 where id = '30000003-0000-0000-0000-000000000000';
update public.profiles set streak_freezes = 2 where id = '30000004-0000-0000-0000-000000000000';

-- ── Privileges and structure ────────────────────────────────────────────────
select function_privs_are('public', 'get_today', array[]::text[], 'authenticated', array['EXECUTE'],
  'signed-in users can call get_today');
select function_privs_are('public', 'get_today', array[]::text[], 'anon', array[]::text[], 'anon cannot');
select function_privs_are('public', 'get_today', array[]::text[], 'service_role', array[]::text[],
  'nor can service_role');
select function_privs_are('public', 'get_today_at', array['uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call the time seam');
select function_privs_are('public', 'get_today_at', array['uuid', 'timestamp with time zone'],
  'service_role', array[]::text[], 'nor can service_role');
select ok((select bool_and(proconfig @> array['search_path=""'] and prosecdef and provolatile = 'v')
           from pg_proc where proname in ('get_today', 'get_today_at') and pronamespace = 'public'::regnamespace),
  'both are VOLATILE SECURITY DEFINER with an empty search_path (D7)');

-- ── Refusals ────────────────────────────────────────────────────────────────
select throws_ok($$select public.get_today_at(null, now())$$, '28000', 'Not signed in', 'no user is refused');
select throws_ok($$select public.get_today_at(gen_random_uuid(), now())$$, 'P0002', 'Profile not found',
  'an unknown user is refused');
select throws_ok($$select pg_temp.today('30000009-0000-0000-0000-000000000000', 1)$$, 'QX107', 'Finish onboarding first',
  'a user who hasn''t onboarded is refused');

-- ── G1: the list ────────────────────────────────────────────────────────────
create temp table r (n text primary key, j jsonb);
insert into r select 'g1a', pg_temp.today('30000001-0000-0000-0000-000000000000', 1);
select is((select array_agg(k order by k) from r, jsonb_object_keys(r.j) k where n = 'g1a'),
  array['at_risk', 'completed_count', 'counted_today', 'current_streak', 'display_name', 'freezes_needed',
        'habits', 'level', 'lifetime_points', 'local_date', 'local_hour', 'longest_streak', 'points_balance',
        'scheduled_count', 'streak_freezes', 'timezone', 'undo_window_minutes', 'username'],
  'the JSON has exactly the documented keys');
select is((select array_agg(k order by k) from r, jsonb_object_keys(pg_temp.habit(r.j, 'A')) k where n = 'g1a'),
  array['category', 'color', 'completions', 'difficulty', 'done', 'habit_streak', 'icon', 'id', 'target', 'title'],
  'each habit has exactly the documented keys');
select ok((select (j ->> 'local_date')::date = pg_temp.day(1) and (j ->> 'local_hour')::int = 12
                  and j ->> 'timezone' = 'UTC' and (j ->> 'undo_window_minutes')::int = 15
           from r where n = 'g1a'),
  'local date, hour, timezone and undo window');
select ok(exists (select 1 from public.daily_schedule
                  where user_id = '30000001-0000-0000-0000-000000000000' and local_date = pg_temp.day(1)),
  'get_today takes the day''s snapshot');
select is((select pg_temp.titles(j) from r where n = 'g1a'), array['B', 'A', 'D'],
  'only today''s scheduled habits, in list order');
select ok((select h ->> 'difficulty' = 'easy' and (h ->> 'target')::int = 3 and (h ->> 'done')::int = 0
                  and h -> 'completions' = '[]'::jsonb and (h ->> 'habit_streak')::int = 0
                  and h -> 'icon' = 'null'::jsonb
           from r, pg_temp.habit(r.j, 'B') h where n = 'g1a'),
  'a habit reports its snapshotted difficulty and target, and no progress yet');
select ok((select (j ->> 'current_streak')::int = 0 and not (j ->> 'counted_today')::boolean
                  and (j ->> 'completed_count')::int = 0 and (j ->> 'scheduled_count')::int = 3
                  and (j ->> 'level')::int = 1
           from r where n = 'g1a'),
  'a fresh player: no streak, nothing done, three habits required');

select pg_temp.done('30000001-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000a', 1, 1);
select pg_temp.done('30000001-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000b', 1, 2);
select pg_temp.done('30000001-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000b', 1, 3);
-- Edit A after today's snapshot: today still uses the snapshotted values.
update public.habits set difficulty = 'hard', target_per_day = 2 where id = 'e1000000-0000-0000-0000-00000000000a';
insert into r select 'g1b', pg_temp.today('30000001-0000-0000-0000-000000000000', 1, 5);
select ok((select (h ->> 'done')::int = 1
                  and jsonb_array_length(h -> 'completions') = 1
                  and (h -> 'completions' -> 0 ->> 'occurrence')::int = 1
                  and (h -> 'completions' -> 0 ->> 'id')::uuid = (select c.id from public.habit_completions c
                       where c.habit_id = 'e1000000-0000-0000-0000-00000000000a')
                  and (h -> 'completions' -> 0 ->> 'undoable_until')::timestamptz = pg_temp.t(1, 16)
                  and (h -> 'completions' -> 0 ->> 'points_awarded')::int = 20
                  and h ->> 'icon' = 'book' and h ->> 'color' = 'violet'
           from r, pg_temp.habit(r.j, 'A') h where n = 'g1b'),
  'a completion is listed with its id, occurrence, points and undo deadline');
select ok((select h ->> 'difficulty' = 'medium' and (h ->> 'target')::int = 1 and (h ->> 'habit_streak')::int = 1
           from r, pg_temp.habit(r.j, 'A') h where n = 'g1b'),
  'an edit after the snapshot doesn''t change today''s difficulty or target');
select ok((select (h ->> 'done')::int = 2 and (h ->> 'habit_streak')::int = 0
                  and (select array_agg((c ->> 'occurrence')::int) from jsonb_array_elements(h -> 'completions') c) = array[1, 2]
           from r, pg_temp.habit(r.j, 'B') h where n = 'g1b'),
  'a multi-target habit lists its completions in order; no habit streak until the target');
select ok((select (j ->> 'completed_count')::int = 3 and (j ->> 'counted_today')::boolean
                  and (j ->> 'current_streak')::int = 1
                  and (j ->> 'points_balance')::int = p.points_balance
                  and (j ->> 'lifetime_points')::int = p.lifetime_points
                  and (j ->> 'level')::int = public.level_for(p.lifetime_points)
           from r, public.profiles p where n = 'g1b' and p.id = '30000001-0000-0000-0000-000000000000'),
  'the day''s counts, streak, balance and level');
select pg_temp.as_user('30000001-0000-0000-0000-000000000000');
select public.archive_habit('e1000000-0000-0000-0000-00000000000d');
select pg_temp.as_postgres();
select is(pg_temp.titles(pg_temp.today('30000001-0000-0000-0000-000000000000', 1, 6)), array['B', 'A'],
  'a habit archived since the snapshot drops off the list');

-- ── G2: a streak the next completion would reset reads 0 ────────────────────
select pg_temp.done('30000002-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('30000002-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000001', 2);
select ok((select (j ->> 'current_streak')::int = 2 and (j ->> 'freezes_needed')::int = 0
                  and (pg_temp.habit(j, 'Daily') ->> 'habit_streak')::int = 2
           from pg_temp.today('30000002-0000-0000-0000-000000000000', 3) j),
  'a streak that ended yesterday is alive today');
select ok((select (j ->> 'current_streak')::int = 0 and (pg_temp.habit(j, 'Daily') ->> 'habit_streak')::int = 0
           from pg_temp.today('30000002-0000-0000-0000-000000000000', 4) j),
  'after a missed day with no freezes, the streak and habit streak read 0');
select is((select current_streak from public.profiles where id = '30000002-0000-0000-0000-000000000000'), 2,
  '(the stored streak is unchanged until the next completion)');

-- ── G3: a freeze will cover the missed day ──────────────────────────────────
select pg_temp.done('30000003-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('30000003-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001', 2);
select ok((select (j ->> 'current_streak')::int = 2 and (j ->> 'freezes_needed')::int = 1
                  and (j ->> 'streak_freezes')::int = 1
           from pg_temp.today('30000003-0000-0000-0000-000000000000', 4) j),
  'with a freeze to cover the missed day, the streak is alive and one freeze is needed');
select is((pg_temp.habit(pg_temp.today('30000003-0000-0000-0000-000000000000', 4, 1), 'Daily') ->> 'habit_streak')::int, 0,
  'per-habit streaks have no freezes, so that habit''s streak reads 0');

-- ── G4: past the lookback, freezes don't help ───────────────────────────────
select pg_temp.done('30000004-0000-0000-0000-000000000000', 'e4000000-0000-0000-0000-000000000001', 1);
select is((pg_temp.today('30000004-0000-0000-0000-000000000000', 10) ->> 'current_streak')::int, 0,
  'a gap longer than the lookback reads 0, even with freezes');

-- ── G5: a rest day ──────────────────────────────────────────────────────────
select pg_temp.done('30000005-0000-0000-0000-000000000000', 'e5000000-0000-0000-0000-000000000001', 1);
select ok((select (j ->> 'scheduled_count')::int = 0 and j -> 'habits' = '[]'::jsonb and not (j ->> 'at_risk')::boolean
           from pg_temp.today('30000005-0000-0000-0000-000000000000', 2, 360) j),
  'a rest day lists nothing and is never at risk');
select is((pg_temp.today('30000005-0000-0000-0000-000000000000', 3) ->> 'current_streak')::int, 1,
  'the rest day doesn''t break the streak');

-- ── G6/G7: at_risk ──────────────────────────────────────────────────────────
select pg_temp.done('30000006-0000-0000-0000-000000000000', 'e6000000-0000-0000-0000-000000000001', 1);
select is((pg_temp.today('30000006-0000-0000-0000-000000000000', 2, 359) ->> 'at_risk')::boolean, false,
  'not at risk at 17:59');
select ok((select (j ->> 'at_risk')::boolean and (j ->> 'local_hour')::int = 18
           from pg_temp.today('30000006-0000-0000-0000-000000000000', 2, 360) j),
  'at risk from 18:00 with a streak and nothing done');
select pg_temp.done('30000006-0000-0000-0000-000000000000', 'e6000000-0000-0000-0000-000000000001', 2, 361);
select is((pg_temp.today('30000006-0000-0000-0000-000000000000', 2, 362) ->> 'at_risk')::boolean, false,
  'not at risk once something is done');
select is((pg_temp.today('30000007-0000-0000-0000-000000000000', 2, 360) ->> 'at_risk')::boolean, false,
  'no streak, nothing to lose: not at risk');

-- ── The client wrapper ──────────────────────────────────────────────────────
select pg_temp.as_user('30000007-0000-0000-0000-000000000000');
select is((public.get_today() ->> 'local_date')::date, (now() at time zone 'UTC')::date,
  'a client gets its own today from the JWT and now()');
select pg_temp.as_postgres();
select set_config('role', 'anon', true);
select throws_ok($$select public.get_today()$$, '42501', null, 'anon is refused');
select pg_temp.as_postgres();

-- ── Level parity (the TS side is lib/points/levels.test.ts) ─────────────────
-- Both pin the same boundaries: level L starts at 50·(L-1)² lifetime points.
select is((select count(*)::int from generate_series(1, 300) as l
           where public.level_for(50 * (l - 1) * (l - 1)) <> l
              or (l > 1 and public.level_for(50 * (l - 1) * (l - 1) - 1) <> l - 1)), 0,
  'level_for: level L starts exactly at 50·(L-1)² for L up to 300');
select ok(public.level_for(0) = 1 and public.level_for(49) = 1 and public.level_for(50) = 2
          and public.level_for(199) = 2 and public.level_for(200) = 3 and public.level_for(-5) = 1
          and public.level_for(4500000) = 301,
  'level_for: the shared fixture values');

select lives_ok($$set constraints all immediate$$, 'deferred FKs hold');
select * from finish();
rollback;
