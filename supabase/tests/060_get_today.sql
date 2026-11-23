-- Phase 4 (#70): get_today — today's snapshot, progress, effective streaks,
-- at_risk (D7) and the SQL side of the level parity test.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

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
  'anon', array[]::text[], 'nor can anon');
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
        'relived', 'scheduled_count', 'streak_freezes', 'timezone', 'undo_window_minutes', 'username'],
  'the JSON has exactly the documented keys');
select is((select array_agg(k order by k) from r, jsonb_object_keys(pg_temp.habit(r.j, 'A')) k where n = 'g1a'),
  array['category', 'color', 'completions', 'difficulty', 'done', 'habit_streak', 'icon', 'id', 'joined_late', 'target', 'title'],
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
select is((pg_temp.today('30000002-0000-0000-0000-000000000000', 4, 360) ->> 'at_risk')::boolean, false,
  'a stored streak the next completion would reset isn''t at risk');
select is((pg_temp.today('30000003-0000-0000-0000-000000000000', 4, 360) ->> 'at_risk')::boolean, true,
  'a streak a freeze will keep is at risk');

-- ── More users: 310000xx, habits ea xx 0000-…-00k ───────────────────────────
-- P1–P6 parity with the next completion · U1/U2 undo · E1/E2 eastward move ·
-- K1 Kolkata · N1/N2 New York DST · M1/M2 habits added mid-day · H1/H2 hidden.
create function pg_temp.u(g text) returns uuid language sql as $$
  select ('310000' || g || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.h(g text, k int) returns uuid language sql as $$
  select ('ea' || g || '0000-0000-0000-0000-00000000000' || k)::uuid $$;
create function pg_temp.all_but(d smallint) returns smallint[] language sql as $$
  select array_agg(x::smallint) from generate_series(0, 6) x where x <> d $$;
insert into auth.users (id, email)
select pg_temp.u(g), 'today-x' || g || '@example.com'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10', '11']) g;
insert into public.habits (id, user_id, title, category, days_of_week, target_per_day, created_at)
select pg_temp.h(g, k), pg_temp.u(g), title, 'mind', coalesce(days, '{0,1,2,3,4,5,6}'), coalesce(target, 1),
       coalesce(created, now() - interval '30 days')
from (values
  ('01', 1, 'Daily', null::smallint[], null::int, null::timestamptz),
  ('01', 2, 'Second', null, null, null),
  ('02', 1, 'Weekly', array[pg_temp.dow(1)], null, null),
  ('03', 1, 'Not day 3', pg_temp.all_but(pg_temp.dow(3)), null, null),
  ('04', 1, 'A', null, null, null),
  ('04', 2, 'B', pg_temp.all_but(pg_temp.dow(2)), null, null),
  ('05', 1, 'A', null, null, null),
  ('05', 2, 'B', null, null, null),
  ('06', 1, 'Twice', null, 2, null),
  ('07', 1, 'Daily', null, null, null),
  ('07', 2, 'Other', null, null, null),
  ('08', 1, 'Daily', null, null, null),
  ('09', 1, 'Daily', null, null, null),
  ('0a', 1, 'Daily', null, null, null),
  ('0b', 1, 'Daily', null, null, null),
  ('0c', 1, 'Daily', null, null, '2027-03-01 12:00+00'),
  ('0d', 1, 'Daily', null, null, '2027-10-20 12:00+00'),
  ('0e', 1, 'Rest', pg_temp.all_but(pg_temp.dow(0)), null, null),
  ('0f', 1, 'Daily', null, null, null),
  ('10', 1, 'Mine', null, null, null),
  ('10', 2, 'Gone', null, null, null),
  ('11', 1, 'Mine', null, null, null),
  ('11', 2, 'Theirs', null, null, null)
) v(g, k, title, days, target, created);
-- Archived two days ago, before onboarding (so no snapshot is taken now).
update public.habits set archived_at = now() - interval '2 days' where id = pg_temp.h('10', 2);
-- Onboarding sets the timezone with it, so the change is free (no cooldown).
update public.profiles p set onboarded_at = coalesce(v.onboarded, now() - interval '30 days'), timezone = v.tz
from (values
  ('01', 'UTC', null::timestamptz), ('02', 'UTC', null), ('03', 'UTC', null), ('04', 'UTC', null),
  ('05', 'UTC', null), ('06', 'UTC', null), ('07', 'UTC', null), ('08', 'UTC', null),
  ('09', 'Pacific/Honolulu', null), ('0a', 'Pacific/Honolulu', null), ('0b', 'Asia/Kolkata', null),
  ('0c', 'America/New_York', '2027-03-01 12:00+00'), ('0d', 'America/New_York', '2027-10-20 12:00+00'),
  ('0e', 'UTC', null), ('0f', 'UTC', null), ('10', 'UTC', null), ('11', 'UTC', null)
) v(g, tz, onboarded)
where p.id = pg_temp.u(v.g);
update public.profiles set streak_freezes = 2 where id = pg_temp.u('01');
update public.profiles set streak_freezes = 1 where id in (pg_temp.u('03'), pg_temp.u('08'), pg_temp.u('0a'));

-- ── Parity: get_today vs what the next completion actually does ─────────────
-- Each probe calls get_today, then completes at the same instant. bump is 1
-- when that completion is the day's first counted one (it adds today), else 0;
-- hbump likewise for the habit's streak (all probed habits have target 1).
create temp table pr (label text primary key, gt jsonb, c jsonb, fb int, fa int, bump int, hbump int, habit uuid);
create function pg_temp.probe(p_label text, p_uid uuid, p_habit uuid, k int, m numeric, p_bump int, p_hbump int)
returns void language plpgsql as $$
declare
  v_gt jsonb := pg_temp.today(p_uid, k, m);
  v_fb int := (select streak_freezes from public.profiles where id = p_uid);
  v_c jsonb := pg_temp.done(p_uid, p_habit, k, m);
begin
  insert into pr values (p_label, v_gt, v_c, v_fb,
    (select streak_freezes from public.profiles where id = p_uid), p_bump, p_hbump, p_habit);
end $$;
create function pg_temp.hs(j jsonb, p_habit uuid) returns int language sql as $$
  select (h ->> 'habit_streak')::int from jsonb_array_elements(j -> 'habits') h where (h ->> 'id')::uuid = p_habit $$;

select pg_temp.probe('p01', pg_temp.u('01'), pg_temp.h('01', 1), 1, 0, 1, 1);  -- first ever
select pg_temp.probe('p02', pg_temp.u('01'), pg_temp.h('01', 1), 2, 0, 1, 1);  -- consecutive
select pg_temp.probe('p03', pg_temp.u('01'), pg_temp.h('01', 1), 4, 0, 1, 1);  -- day 3 missed: a freeze
select pg_temp.probe('p04', pg_temp.u('01'), pg_temp.h('01', 2), 4, 1, 0, 1);  -- already counted today
select pg_temp.probe('p05', pg_temp.u('01'), pg_temp.h('01', 1), 7, 0, 1, 1);  -- 2 missed, 1 freeze: broken
select pg_temp.probe('p06', pg_temp.u('01'), pg_temp.h('01', 1), 9, 0, 1, 1);  -- 1 missed, 1 freeze
update public.profiles set streak_freezes = 2 where id = pg_temp.u('01');
select pg_temp.probe('p07', pg_temp.u('01'), pg_temp.h('01', 1), 19, 0, 1, 1); -- past the lookback
select pg_temp.probe('p08', pg_temp.u('02'), pg_temp.h('02', 1), 1, 0, 1, 1);
select pg_temp.probe('p09', pg_temp.u('02'), pg_temp.h('02', 1), 8, 0, 1, 1);  -- six rest days between
select pg_temp.done(pg_temp.u('03'), pg_temp.h('03', 1), 1);
select pg_temp.probe('p10', pg_temp.u('03'), pg_temp.h('03', 1), 4, 0, 1, 1);  -- missed + rest: one freeze
select pg_temp.done(pg_temp.u('04'), pg_temp.h('04', 1), 1);
select pg_temp.done(pg_temp.u('04'), pg_temp.h('04', 2), 1, 1);
select pg_temp.done(pg_temp.u('04'), pg_temp.h('04', 1), 2);
select pg_temp.probe('p11', pg_temp.u('04'), pg_temp.h('04', 2), 3, 0, 1, 1);  -- B rested on day 2
select pg_temp.probe('p12', pg_temp.u('04'), pg_temp.h('04', 1), 3, 1, 0, 1);
select pg_temp.done(pg_temp.u('05'), pg_temp.h('05', 1), 2);
select pg_temp.done(pg_temp.u('05'), pg_temp.h('05', 1), 3);
select pg_temp.probe('p13', pg_temp.u('05'), pg_temp.h('05', 2), 2, 60, 0, 1); -- day 2 relived (moved west)

select is((select coalesce(array_agg(label order by label), '{}') from pr
           where (c ->> 'current_streak')::int - (gt ->> 'current_streak')::int <> bump), '{}'::text[],
  'parity: get_today''s current_streak is what the next completion reports, minus the day it adds');
select is((select coalesce(array_agg(label order by label), '{}') from pr
           where (gt ->> 'freezes_needed')::int <> fb - fa or (gt ->> 'streak_freezes')::int <> fb), '{}'::text[],
  'parity: freezes_needed is exactly what the next completion spends');
select is((select coalesce(array_agg(label order by label), '{}') from pr
           where (c ->> 'habit_streak')::int - pg_temp.hs(gt, habit) is distinct from hbump), '{}'::text[],
  'parity: each habit''s streak is what its next completion reports, minus the day it adds');
select is((select array_agg((gt ->> 'current_streak')::int order by label) from pr),
  array[0, 1, 2, 3, 0, 1, 0, 0, 1, 1, 2, 3, 2],
  'parity cases: the effective streaks (first, consecutive, frozen, counted, broken, frozen, lookback, rest days, relived)');
select is((select array_agg((gt ->> 'freezes_needed')::int order by label) from pr),
  array[0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  'parity cases: freezes needed (none when broken or past the lookback; rest days cost nothing)');
select is((select array_agg(fa order by label) from pr),
  array[2, 2, 1, 1, 1, 0, 2, 0, 0, 0, 0, 0, 0],
  'parity cases: freezes left after each completion (a broken streak spends none)');
select is((select array_agg(pg_temp.hs(gt, habit) order by label) from pr),
  array[0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 2, 0],
  'parity cases: habit streaks (no freezes; a habit''s own rest days don''t break it)');

-- P6: a target-2 habit; its streak advances on the completion that reaches it.
select pg_temp.done(pg_temp.u('06'), pg_temp.h('06', 1), 1);
select pg_temp.done(pg_temp.u('06'), pg_temp.h('06', 1), 1, 1);
insert into r select 'p6a', pg_temp.today(pg_temp.u('06'), 2);
insert into r select 'p6b', pg_temp.done(pg_temp.u('06'), pg_temp.h('06', 1), 2, 1);
insert into r select 'p6c', pg_temp.today(pg_temp.u('06'), 2, 2);
insert into r select 'p6d', pg_temp.done(pg_temp.u('06'), pg_temp.h('06', 1), 2, 3);
select ok((select pg_temp.hs(a.j, pg_temp.h('06', 1)) = 1
                  and pg_temp.hs(c.j, pg_temp.h('06', 1)) = 1
                  and (pg_temp.habit(c.j, 'Twice') ->> 'done')::int = 1
                  and (d.j ->> 'habit_streak')::int = pg_temp.hs(a.j, pg_temp.h('06', 1)) + 1
           from r a, r c, r d where a.n = 'p6a' and c.n = 'p6c' and d.n = 'p6d'),
  'parity: a multi-target habit''s streak is one less than the completion that reaches the target reports');

-- ── at_risk after undo ──────────────────────────────────────────────────────
select pg_temp.done(pg_temp.u('07'), pg_temp.h('07', 1), 1);
insert into r select 'u1a', pg_temp.done(pg_temp.u('07'), pg_temp.h('07', 1), 2, 390);
insert into r select 'u1b', pg_temp.done(pg_temp.u('07'), pg_temp.h('07', 2), 2, 391);
select public.undo_completion_at(pg_temp.u('07'), (select (j ->> 'completion_id')::uuid from r where n = 'u1b'), pg_temp.t(2, 392));
select ok((select not (j ->> 'at_risk')::boolean and (j ->> 'counted_today')::boolean
                  and (j ->> 'completed_count')::int = 1 and (j ->> 'current_streak')::int = 2
           from pg_temp.today(pg_temp.u('07'), 2, 392.5) j),
  'an undo that leaves something done today: still counted, not at risk');
select public.undo_completion_at(pg_temp.u('07'), (select (j ->> 'completion_id')::uuid from r where n = 'u1a'), pg_temp.t(2, 393));
select ok((select (j ->> 'at_risk')::boolean and not (j ->> 'counted_today')::boolean
                  and (j ->> 'completed_count')::int = 0 and (j ->> 'current_streak')::int = 1
                  and (j ->> 'freezes_needed')::int = 0
                  and (h ->> 'done')::int = 0 and h -> 'completions' = '[]'::jsonb
                  and (h ->> 'habit_streak')::int = 1
           from pg_temp.today(pg_temp.u('07'), 2, 394) j, pg_temp.habit(j, 'Daily') h),
  'an undo that empties the day after 18:00: at risk again, with the streak and habit streak restored');
select is((pg_temp.done(pg_temp.u('07'), pg_temp.h('07', 1), 2, 395) ->> 'current_streak')::int, 2,
  '(and completing again counts the day)');
select pg_temp.done(pg_temp.u('08'), pg_temp.h('08', 1), 1);
insert into r select 'u2a', pg_temp.done(pg_temp.u('08'), pg_temp.h('08', 1), 3, 390);
select public.undo_completion_at(pg_temp.u('08'), (select (j ->> 'completion_id')::uuid from r where n = 'u2a'), pg_temp.t(3, 395));
select ok((select (j ->> 'at_risk')::boolean and (j ->> 'freezes_needed')::int = 1
                  and (j ->> 'streak_freezes')::int = 1 and (j ->> 'current_streak')::int = 1
           from pg_temp.today(pg_temp.u('08'), 3, 396) j),
  'undoing a day that spent a freeze: the freeze is back, needed again, and the streak is at risk');

-- ── Eastward move (real now(): the timezone trigger uses it) ────────────────
-- Honolulu (UTC-10) to Kiritimati (UTC+14) is always exactly one date ahead.
create function pg_temp.kiri20() returns timestamptz language sql as $$
  select ((now() at time zone 'Pacific/Kiritimati')::date + time '20:00') at time zone 'Pacific/Kiritimati' $$;
select public.complete_habit_at(pg_temp.u('09'), pg_temp.h('09', 1), now());
update public.profiles set timezone = 'Pacific/Kiritimati' where id = pg_temp.u('09');
select ok((select (j ->> 'local_date')::date = (now() at time zone 'Pacific/Honolulu')::date + 1
                  and (j ->> 'local_hour')::int = 20 and j ->> 'timezone' = 'Pacific/Kiritimati'
                  and (j ->> 'current_streak')::int = 1 and (j ->> 'freezes_needed')::int = 0
                  and not (j ->> 'counted_today')::boolean and not (j ->> 'at_risk')::boolean
                  and (pg_temp.habit(j, 'Daily') ->> 'habit_streak')::int = 1
           from public.get_today_at(pg_temp.u('09'), pg_temp.kiri20()) j),
  'after an eastward move that inherits the counted day: the streak holds and isn''t at risk');
select ok((select (c ->> 'current_streak')::int = 1 and (c ->> 'habit_streak')::int = 1
           from public.complete_habit_at(pg_temp.u('09'), pg_temp.h('09', 1), pg_temp.kiri20()) c),
  '(and the next completion indeed adds no day, as get_today said)');
select public.complete_habit_at(pg_temp.u('0a'), pg_temp.h('0a', 1), now() - interval '1 day');
update public.profiles set timezone = 'Pacific/Kiritimati' where id = pg_temp.u('0a');
select ok((select (j ->> 'current_streak')::int = 1 and (j ->> 'freezes_needed')::int = 1
                  and (j ->> 'at_risk')::boolean
                  and (pg_temp.habit(j, 'Daily') ->> 'habit_streak')::int = 0
           from public.get_today_at(pg_temp.u('0a'), pg_temp.kiri20()) j),
  'an eastward move with today pending: no inheritance, the old today needs a freeze, at risk');
insert into r select 'e2c', public.complete_habit_at(pg_temp.u('0a'), pg_temp.h('0a', 1), pg_temp.kiri20());
select ok((select (j ->> 'current_streak')::int = 2
                  and (select streak_freezes from public.profiles where id = pg_temp.u('0a')) = 0
           from r where n = 'e2c'),
  '(and the next completion spends that freeze)');

-- ── Non-UTC: Kolkata (UTC+5:30); noon UTC is 17:30 there ────────────────────
select pg_temp.done(pg_temp.u('0b'), pg_temp.h('0b', 1), 1);
select ok((select (j ->> 'local_hour')::int = 17 and not (j ->> 'at_risk')::boolean
           from pg_temp.today(pg_temp.u('0b'), 2, 29) j),
  'Kolkata 17:59: not at risk');
select ok((select (j ->> 'local_hour')::int = 18 and (j ->> 'at_risk')::boolean
                  and (j ->> 'local_date')::date = pg_temp.day(2)
           from pg_temp.today(pg_temp.u('0b'), 2, 30) j),
  'Kolkata 18:00 (12:30 UTC): at risk');
select ok((select (j ->> 'local_date')::date = pg_temp.day(3) and (j ->> 'local_hour')::int = 5
                  and (j ->> 'current_streak')::int = 0 and not (j ->> 'at_risk')::boolean
           from pg_temp.today(pg_temp.u('0b'), 2, 690) j),
  'Kolkata 05:00 is the next local day while UTC is still on day 2; day 2 was missed');

-- ── DST: New York, spring forward (2027-03-14) ──────────────────────────────
select public.complete_habit_at(pg_temp.u('0c'), pg_temp.h('0c', 1), '2027-03-13 17:00+00');
select ok((select (a ->> 'local_hour')::int = 1 and (b ->> 'local_hour')::int = 3
                  and (a ->> 'local_date')::date = '2027-03-14' and (b ->> 'local_date')::date = '2027-03-14'
           from public.get_today_at(pg_temp.u('0c'), '2027-03-14 06:59+00') a,
                public.get_today_at(pg_temp.u('0c'), '2027-03-14 07:00+00') b),
  'spring forward: 01:59 EST is followed by 03:00 EDT');
select ok((select (a ->> 'local_hour')::int = 17 and not (a ->> 'at_risk')::boolean
                  and (b ->> 'local_hour')::int = 18 and (b ->> 'at_risk')::boolean
                  and (b ->> 'current_streak')::int = 1
           from public.get_today_at(pg_temp.u('0c'), '2027-03-14 21:59+00') a,
                public.get_today_at(pg_temp.u('0c'), '2027-03-14 22:00+00') b),
  'spring forward: at risk from 18:00 EDT (22:00 UTC), not at 17:59');
select ok((select (c ->> 'local_date')::date = '2027-03-14' and (c ->> 'current_streak')::int = 2
                  and (j ->> 'local_date')::date = '2027-03-15' and (j ->> 'local_hour')::int = 0
                  and (j ->> 'current_streak')::int = 2 and not (j ->> 'at_risk')::boolean
           from public.complete_habit_at(pg_temp.u('0c'), pg_temp.h('0c', 1), '2027-03-15 03:30+00') c,
                public.get_today_at(pg_temp.u('0c'), '2027-03-15 04:30+00') j),
  'the 23-hour day counts: 23:30 EDT is still 03-14, and the streak is alive at 00:30 on 03-15');
-- 03-14 now has a completion, so its timestamps are compared as instants.
insert into r select 'n1utc', public.get_today_at(pg_temp.u('0c'), '2027-03-15 03:31+00');
set local timezone = 'Pacific/Kiritimati';
insert into r select 'n1kiri', public.get_today_at(pg_temp.u('0c'), '2027-03-15 03:31+00');
reset timezone;
select ok((select (k.j - 'habits') = (u.j - 'habits')
                  and (k.j ->> 'local_date')::date = '2027-03-14' and (k.j ->> 'local_hour')::int = 23
                  and (kc ->> 'undoable_until')::timestamptz = (uc ->> 'undoable_until')::timestamptz
                  and (kc ->> 'completed_at')::timestamptz = '2027-03-15 03:30+00'
           from r u, r k,
                lateral (select pg_temp.habit(k.j, 'Daily') -> 'completions' -> 0) kk(kc),
                lateral (select pg_temp.habit(u.j, 'Daily') -> 'completions' -> 0) uu(uc)
           where u.n = 'n1utc' and k.n = 'n1kiri'),
  'the session timezone changes nothing: same local date, hour, flags and completion instants');

-- ── DST: New York, fall back (2027-11-07) ───────────────────────────────────
select public.complete_habit_at(pg_temp.u('0d'), pg_temp.h('0d', 1), '2027-11-06 16:00+00');
select ok((select (a ->> 'local_hour')::int = 1 and (b ->> 'local_hour')::int = 1
                  and (a ->> 'local_date')::date = '2027-11-07' and (b ->> 'local_date')::date = '2027-11-07'
           from public.get_today_at(pg_temp.u('0d'), '2027-11-07 05:30+00') a,
                public.get_today_at(pg_temp.u('0d'), '2027-11-07 06:30+00') b),
  'fall back: 01:30 EDT and 01:30 EST are both hour 1');
select ok((select (a ->> 'local_hour')::int = 17 and not (a ->> 'at_risk')::boolean
                  and (b ->> 'local_hour')::int = 18 and (b ->> 'at_risk')::boolean
           from public.get_today_at(pg_temp.u('0d'), '2027-11-07 22:59+00') a,
                public.get_today_at(pg_temp.u('0d'), '2027-11-07 23:00+00') b),
  'fall back: at risk from 18:00 EST (23:00 UTC), not at 17:59');
select ok((select (a ->> 'local_date')::date = '2027-11-07' and (a ->> 'local_hour')::int = 23
                  and (a ->> 'at_risk')::boolean
                  and (b ->> 'local_date')::date = '2027-11-08' and (b ->> 'current_streak')::int = 0
                  and not (b ->> 'at_risk')::boolean
           from public.get_today_at(pg_temp.u('0d'), '2027-11-08 04:59+00') a,
                public.get_today_at(pg_temp.u('0d'), '2027-11-08 05:00+00') b),
  'the 25-hour day ends at 05:00 UTC; at its end the missed day breaks the streak');

-- ── Habits added mid-day (real now(): the habit triggers use it) ────────────
create function pg_temp.end_of_today() returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '1 day' - interval '1 microsecond' $$;
-- M1: today is a rest day; M2: today has one habit. Both then add 'Late'.
select pg_temp.done(pg_temp.u('0e'), pg_temp.h('0e', 1), -1);
select public.get_today_at(pg_temp.u('0e'), now());
select public.get_today_at(pg_temp.u('0f'), now());
insert into public.habits (user_id, title, category) values
  (pg_temp.u('0e'), 'Late', 'mind'), (pg_temp.u('0f'), 'Late', 'mind');
select ok((select pg_temp.titles(j) = array['Late'] and (j ->> 'scheduled_count')::int = 0
                  and (j ->> 'current_streak')::int = 1 and (j ->> 'local_hour')::int = 23
                  and not (j ->> 'at_risk')::boolean
           from public.get_today_at(pg_temp.u('0e'), pg_temp.end_of_today()) j),
  'a habit added on a rest day is listed, but the day stays a rest day and isn''t at risk');
select ok((select (c ->> 'current_streak')::int = 1 and not (j ->> 'counted_today')::boolean
                  and (j ->> 'completed_count')::int = 1 and (j ->> 'scheduled_count')::int = 0
                  and (pg_temp.habit(j, 'Late') ->> 'done')::int = 1
                  and (pg_temp.habit(j, 'Late') ->> 'joined_late')::boolean
           from public.complete_habit_at(pg_temp.u('0e'),
                  (select id from public.habits where user_id = pg_temp.u('0e') and title = 'Late'),
                  pg_temp.end_of_today()) c,
                public.get_today_at(pg_temp.u('0e'), pg_temp.end_of_today()) j),
  '(it can be completed for points, but a habit that joined late doesn''t count the day, #82)');
select ok((select pg_temp.titles(j) = array['Daily', 'Late'] and (j ->> 'scheduled_count')::int = 1
           from public.get_today_at(pg_temp.u('0f'), pg_temp.end_of_today()) j),
  'a habit added mid-day is listed after the others, but scheduled_count is unchanged');

-- ── Hidden habits: archived, or another user's ──────────────────────────────
select pg_temp.done(pg_temp.u('11'), pg_temp.h('11', 1), 1);
insert into r select 'h1', pg_temp.today(pg_temp.u('10'), 1, 1);
select ok((select pg_temp.titles(j) = array['Mine'] and (pg_temp.habit(j, 'Mine') ->> 'id')::uuid = pg_temp.h('10', 1)
           from r where n = 'h1'),
  'a habit archived before today and another user''s habits never appear');
select ok((select not exists (select 1 from jsonb_array_elements(j -> 'habits') h
                              where (h ->> 'id')::uuid not in (select id from public.habits
                                                                where user_id = pg_temp.u('10') and archived_at is null))
                  and (pg_temp.habit(j, 'Mine') ->> 'done')::int = 0 and (j ->> 'completed_count')::int = 0
           from r where n = 'h1'),
  'every listed id is one of the user''s active habits, and another user''s completions don''t count');

-- ── JSON value types (on G1's day with completions) ─────────────────────────
select is((select array_agg(k || ':' || jsonb_typeof(j -> k) order by k) from r, jsonb_object_keys(r.j) k where n = 'g1b'),
  array['at_risk:boolean', 'completed_count:number', 'counted_today:boolean', 'current_streak:number',
        'display_name:' || jsonb_typeof(coalesce(to_jsonb((select display_name from public.profiles
                                                            where id = '30000001-0000-0000-0000-000000000000')), 'null')),
        'freezes_needed:number', 'habits:array', 'level:number', 'lifetime_points:number',
        'local_date:string', 'local_hour:number', 'longest_streak:number', 'points_balance:number',
        'relived:boolean', 'scheduled_count:number', 'streak_freezes:number', 'timezone:string', 'undo_window_minutes:number',
        'username:string'],
  'top-level JSON types (dates as strings, counts as numbers, flags as booleans)');
select ok((select j ->> 'local_date' ~ '^\d{4}-\d{2}-\d{2}$' and (j -> 'local_hour')::text ~ '^\d+$'
                  and j ->> 'username' = p.username::text
                  and j -> 'display_name' = coalesce(to_jsonb(p.display_name), 'null')
           from r, public.profiles p where n = 'g1b' and p.id = '30000001-0000-0000-0000-000000000000'),
  'local_date is YYYY-MM-DD, local_hour a whole number, and the names are the profile''s');
select is((select array_agg(k || ':' || jsonb_typeof(h -> k) order by k)
           from r, pg_temp.habit(r.j, 'A') h, jsonb_object_keys(h) k where n = 'g1b'),
  array['category:string', 'color:string', 'completions:array', 'difficulty:string', 'done:number',
        'habit_streak:number', 'icon:string', 'id:string', 'joined_late:boolean', 'target:number', 'title:string'],
  'habit JSON types');
select is((select array_agg(k || ':' || jsonb_typeof(c -> k) order by k)
           from r, pg_temp.habit(r.j, 'A') h, jsonb_array_elements(h -> 'completions') c, jsonb_object_keys(c) k
           where n = 'g1b'),
  array['completed_at:string', 'id:string', 'occurrence:number', 'points_awarded:number', 'undoable_until:string'],
  'completion JSON types');

-- ── undoable_until stops at local midnight (undo refuses yesterday, QX105) ──
select pg_temp.done('30000007-0000-0000-0000-000000000000', 'e7000000-0000-0000-0000-000000000001', 5, 715);
select ok((select (h -> 'completions' -> 0 ->> 'undoable_until')::timestamptz = pg_temp.t(5, 720)
           from pg_temp.habit(pg_temp.today('30000007-0000-0000-0000-000000000000', 5, 716), 'Daily') h),
  'a completion at 23:55 is undoable until 00:00, not 00:10');
select throws_ok($$select public.undo_completion_at('30000007-0000-0000-0000-000000000000',
                   (select id from public.habit_completions where user_id = '30000007-0000-0000-0000-000000000000'
                    and local_date = pg_temp.day(5)), pg_temp.t(5, 721))$$,
  'QX105', null, '(and undo indeed refuses it a minute after midnight)');

-- Atlantic/Azores, 2026-10-25: clocks go back from 01:00 to 00:00, so
-- midnight happens twice. The date changes at the first (00:00Z).
insert into auth.users (id, email) values ('32000001-0000-0000-0000-000000000000', 'azores@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('e9000000-0000-0000-0000-000000000001', '32000001-0000-0000-0000-000000000000', 'Daily', 'mind', '2026-10-01 12:00+00');
update public.profiles set timezone = 'Atlantic/Azores' where id = '32000001-0000-0000-0000-000000000000';
update public.profiles set onboarded_at = '2026-10-01 12:00+00' where id = '32000001-0000-0000-0000-000000000000';
select public.complete_habit_at('32000001-0000-0000-0000-000000000000', 'e9000000-0000-0000-0000-000000000001',
                                '2026-10-24 23:55+00');
select is((public.get_today_at('32000001-0000-0000-0000-000000000000', '2026-10-24 23:56+00')
           -> 'habits' -> 0 -> 'completions' -> 0 ->> 'undoable_until')::timestamptz,
  '2026-10-25 00:00+00'::timestamptz,
  'where midnight happens twice, the undo deadline is the first one, when the date changes');

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
