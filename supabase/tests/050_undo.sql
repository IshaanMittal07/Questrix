-- Phase 4 (#69): undo_completion — exact restore, occurrence reuse, the undo
-- window, the previous-day and spent-balance guards, milestone revocation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(103);

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
-- Noon UTC k days from today, plus m minutes: a 15-minute window never
-- crosses midnight unless a test means it to.
create function pg_temp.t(k int, m numeric default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + k * interval '1 day' + interval '12 hours' + m * interval '1 minute' $$;
create function pg_temp.day(k int) returns date language sql as $$
  select (pg_temp.t(k) at time zone 'UTC')::date $$;

-- Completions by name, so undos can refer to them.
create temp table done_ids (n text primary key, id uuid, j jsonb);
create function pg_temp.done(p_n text, p_uid uuid, p_habit uuid, k int, m numeric default 0)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v := public.complete_habit_at(p_uid, p_habit, pg_temp.t(k, m));
  insert into done_ids as d values (p_n, (v ->> 'completion_id')::uuid, v)
  on conflict on constraint done_ids_pkey do update set id = excluded.id, j = excluded.j;
  return v;
end $$;
create function pg_temp.c(n text) returns uuid language sql as $$
  select id from done_ids where done_ids.n = c.n $$;
create function pg_temp.undo(p_uid uuid, n text, k int, m numeric) returns jsonb language sql as $$
  select public.undo_completion_at(p_uid, pg_temp.c(n), pg_temp.t(k, m)) $$;

-- The streak state undo must restore, as text for exact comparison.
create function pg_temp.st(p_uid uuid) returns text language sql as $$
  select row(points_balance, lifetime_points, current_streak, longest_streak,
             last_streak_date, streak_freezes, streak_run_started)::text
  from public.profiles where id = p_uid $$;
create function pg_temp.hst(p_habit uuid) returns text language sql as $$
  select coalesce((select row(current, longest, last_date)::text
                   from public.habit_streaks where habit_id = p_habit), 'none') $$;
create temp table snap (n text primary key, v text);
create function pg_temp.keep(n text, v text) returns void language sql as $$
  insert into snap values (n, v) on conflict (n) do update set v = excluded.v $$;
create function pg_temp.kept(n text) returns text language sql as $$
  select v from snap where snap.n = kept.n $$;

-- Spending before Phase 6: a postgres-only admin_adjust (DECISIONS).
create function pg_temp.spend(p_uid uuid, p_amount int) returns void language sql as $$
  insert into public.points_ledger (user_id, delta, reason) values (p_uid, -p_amount, 'admin_adjust');
  update public.profiles set points_balance = points_balance - p_amount where id = p_uid;
$$;
create function pg_temp.balance(p_uid uuid) returns int language sql as $$
  select points_balance from public.profiles where id = p_uid $$;
create function pg_temp.balance_ok(p_uid uuid) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = p_uid)
     and (select lifetime_points from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger
          where user_id = p_uid and reason in ('completion', 'streak_milestone', 'undo')) $$;

-- U1 restore and reuse · U2 milestones · U3 freezes · U4 guards ·
-- U5 a stranger · U6 a day that's no longer the latest · U7 the wrapper ·
-- U8 a milestone farming loop · U9 a freeze farming loop ·
-- V1 a reset day · V2 a non-last occurrence with a prior habit streak ·
-- V3 two habits on a milestone day · V4 the exact balance ·
-- V5 undoing D then D+1 across midnight (M1) · V6 a stale sibling habit state.
create function pg_temp.mine(p_uid uuid) returns boolean language sql as $$
  select left(p_uid::text, 7) in ('2000000', '2100000') $$;
insert into auth.users (id, email)
select ('2000000' || g || '-0000-0000-0000-000000000000')::uuid, 'undo' || g || '@example.com'
from generate_series(1, 9) as g
union all
select ('2100000' || g || '-0000-0000-0000-000000000000')::uuid, 'undov' || g || '@example.com'
from generate_series(1, 6) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select ('b' || g || '000000-0000-0000-0000-000000000001')::uuid,
       ('2000000' || g || '-0000-0000-0000-000000000000')::uuid,
       'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'
from generate_series(1, 9) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select ('c' || g || '000000-0000-0000-0000-000000000001')::uuid,
       ('2100000' || g || '-0000-0000-0000-000000000000')::uuid,
       'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'
from generate_series(1, 6) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at) values
  ('b1000000-0000-0000-0000-000000000003', '20000001-0000-0000-0000-000000000000',
   'Water', 'nutrition', 'easy', '{0,1,2,3,4,5,6}', 3, now() - interval '30 days'),
  -- V2: a target-3 habit (its target-1 habit is never completed).
  ('c2000000-0000-0000-0000-000000000003', '21000002-0000-0000-0000-000000000000',
   'Water', 'nutrition', 'easy', '{0,1,2,3,4,5,6}', 3, now() - interval '30 days'),
  -- V3: a second habit.
  ('c3000000-0000-0000-0000-000000000002', '21000003-0000-0000-0000-000000000000',
   'Read', 'mind', 'hard', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  -- V6: target 2.
  ('c6000000-0000-0000-0000-000000000002', '21000006-0000-0000-0000-000000000000',
   'Stretch', 'fitness', 'easy', '{0,1,2,3,4,5,6}', 2, now() - interval '30 days');
update public.profiles set onboarded_at = now() - interval '30 days' where pg_temp.mine(id);
update public.profiles set streak_freezes = 1
 where id in ('20000003-0000-0000-0000-000000000000', '20000009-0000-0000-0000-000000000000');

-- ── Privileges and structure ────────────────────────────────────────────────
select function_privs_are('public', 'undo_completion', array['uuid'], 'authenticated', array['EXECUTE'],
  'signed-in users can call undo_completion');
select function_privs_are('public', 'undo_completion', array['uuid'], 'anon', array[]::text[],
  'anon cannot');
select function_privs_are('public', 'undo_completion', array['uuid'], 'service_role', array[]::text[],
  'nor can service_role');
select function_privs_are('public', 'undo_completion_at', array['uuid', 'uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call the time seam');
select function_privs_are('public', 'undo_completion_at', array['uuid', 'uuid', 'timestamp with time zone'],
  'service_role', array[]::text[], 'nor can service_role');
select ok((select bool_and(proconfig @> array['search_path=""'] and prosecdef) from pg_proc
           where proname in ('undo_completion', 'undo_completion_at')
             and pronamespace = 'public'::regnamespace),
  'both are SECURITY DEFINER with an empty search_path');
select ok((select position('for no key update' in prosrc) > 0
                  and position('for no key update' in prosrc) < position('from public.habit_completions' in prosrc)
           from pg_proc where oid = 'public.undo_completion_at(uuid, uuid, timestamptz)'::regprocedure),
  'it locks the profile FOR NO KEY UPDATE before the completion (D5)');

-- ── U1: a first-ever day, undone, restores the empty state ──────────────────
select pg_temp.keep('u1.pre', pg_temp.st('20000001-0000-0000-0000-000000000000'));
select pg_temp.done('u1d1', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 1);
create temp table r1 as
select pg_temp.undo('20000001-0000-0000-0000-000000000000', 'u1d1', 1, 5) as j;
select is(pg_temp.st('20000001-0000-0000-0000-000000000000'), pg_temp.kept('u1.pre'),
  'undoing the first-ever completion restores balance, lifetime and streak state exactly');
select is(pg_temp.hst('b1000000-0000-0000-0000-000000000001'), 'none',
  'and deletes the habit streak row it created');
select ok(not exists (select 1 from public.habit_completions where id = pg_temp.c('u1d1')),
  'the completion is gone');
select ok((select not counted_for_streak and completed_count = 0 from public.daily_progress
           where user_id = '20000001-0000-0000-0000-000000000000' and local_date = pg_temp.day(1)),
  'the emptied day is no longer counted');
select is((select delta from public.points_ledger where reason = 'undo' and ref_id = pg_temp.c('u1d1')),
  -((select j ->> 'points_awarded' from done_ids where n = 'u1d1')::int),
  'an undo ledger entry reverses the award, referencing the completion');
select ok((select (j ->> 'undone_id')::uuid = pg_temp.c('u1d1')
                  and (j ->> 'points_removed')::int = (select (d.j ->> 'points_awarded')::int from done_ids d where d.n = 'u1d1')
                  and j -> 'milestones_revoked' = '[]'::jsonb
                  and (j ->> 'milestone_points_removed')::int = 0
                  and (j ->> 'current_streak')::int = 0
                  and (j ->> 'habit_streak')::int = 0
                  and (j ->> 'new_balance')::int = 0
                  and (j ->> 'lifetime_points')::int = 0
                  and (j ->> 'level')::int = 1
                  and (j ->> 'local_date')::date = pg_temp.day(1)
           from r1),
  'the JSON reports what was undone and the new state');

-- Redo day 1, then day 2: undoing day 2 restores day 1's end state.
select pg_temp.done('u1d1b', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 1, 10);
select is((select current_streak from public.profiles where id = '20000001-0000-0000-0000-000000000000'), 1,
  'redoing an undone day counts it again');
select pg_temp.keep('u1.pre2', pg_temp.st('20000001-0000-0000-0000-000000000000'));
select pg_temp.keep('u1.hpre2', pg_temp.hst('b1000000-0000-0000-0000-000000000001'));
select pg_temp.done('u1d2', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 2);
select is((select current_streak from public.profiles where id = '20000001-0000-0000-0000-000000000000'), 2,
  '(day 2 makes the streak 2)');
select pg_temp.undo('20000001-0000-0000-0000-000000000000', 'u1d2', 2, 1);
select is(pg_temp.st('20000001-0000-0000-0000-000000000000'), pg_temp.kept('u1.pre2'),
  'undoing day 2 restores balance, lifetime, streak, longest, last date, freezes and run start exactly');
select is(pg_temp.hst('b1000000-0000-0000-0000-000000000001'), pg_temp.kept('u1.hpre2'),
  'and the per-habit streak');
select is((pg_temp.done('u1d2b', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 2, 2)
           ->> 'current_streak')::int, 2,
  'redoing day 2 makes the streak 2 again');

-- Occurrence reuse (plan §10): target 3, complete #1 and #2, undo #1.
select pg_temp.done('w1', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000003', 2, 3);
select pg_temp.done('w2', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000003', 2, 4);
select pg_temp.undo('20000001-0000-0000-0000-000000000000', 'w1', 2, 5);
select is((pg_temp.done('w1b', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000003', 2, 6)
           ->> 'occurrence')::int, 1,
  'completing again reuses the freed occurrence 1');
select is((pg_temp.done('w3', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000003', 2, 7)
           ->> 'occurrence')::int, 3,
  'then takes occurrence 3');
select throws_ok($$select public.complete_habit_at('20000001-0000-0000-0000-000000000000',
                   'b1000000-0000-0000-0000-000000000003', pg_temp.t(2, 8))$$,
  'QX103', null, 'and a fourth is refused: the target still caps the day');
select is((select current from public.habit_streaks where habit_id = 'b1000000-0000-0000-0000-000000000003'), 1,
  '(reaching the target started the habit''s streak)');
select pg_temp.undo('20000001-0000-0000-0000-000000000000', 'w2', 2, 9);
select is(pg_temp.hst('b1000000-0000-0000-0000-000000000003'), 'none',
  'dropping below the target removes the streak row that day created');
select ok((select current_streak = 2 and last_streak_date = pg_temp.day(2) from public.profiles
           where id = '20000001-0000-0000-0000-000000000000')
          and (select counted_for_streak from public.daily_progress
               where user_id = '20000001-0000-0000-0000-000000000000' and local_date = pg_temp.day(2)),
  'undoing one of several completions leaves the day''s streak alone');
select is((pg_temp.done('w2b', '20000001-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000003', 2, 10)
           ->> 'habit_streak')::int, 1,
  'reaching the target again restarts the habit streak at 1');

-- ── U4: the window, the day, ownership and the spent balance ────────────────
select pg_temp.done('u4a', '20000004-0000-0000-0000-000000000000', 'b4000000-0000-0000-0000-000000000001', 1);
select throws_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4a', 1, 15 + 1.0 / 60)$$,
  'QX104', 'Undo is only possible for 15 minutes', 'a second past the 15-minute window is refused');
select lives_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4a', 1, 15)$$,
  'exactly 15 minutes is still inside the window');
select throws_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4a', 1, 16)$$,
  'P0002', 'Completion not found', 'an undone completion can''t be undone again');
-- 23:55 on day 2, undone at 00:05 on day 3: inside the window, but not today.
select pg_temp.done('u4b', '20000004-0000-0000-0000-000000000000', 'b4000000-0000-0000-0000-000000000001', 2, 715);
select throws_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4b', 2, 725)$$,
  'QX105', 'You can only undo today''s completions', 'a previous day''s completion is refused, even inside the window');
select throws_ok($$select pg_temp.undo('20000005-0000-0000-0000-000000000000', 'u4b', 2, 716)$$,
  'P0002', 'Completion not found', 'another user''s completion is "not found"');
select throws_ok($$select public.undo_completion_at('20000004-0000-0000-0000-000000000000', gen_random_uuid(), pg_temp.t(2, 716))$$,
  'P0002', 'Completion not found', 'an unknown completion is "not found"');
select throws_ok($$select public.undo_completion_at(null, pg_temp.c('u4b'), pg_temp.t(2, 716))$$,
  '28000', 'Not signed in', 'no user is refused');
select throws_ok($$select public.undo_completion_at(gen_random_uuid(), pg_temp.c('u4b'), pg_temp.t(2, 716))$$,
  'P0002', 'Profile not found', 'a user with no profile is refused');
-- Complete, spend, undo.
select pg_temp.done('u4c', '20000004-0000-0000-0000-000000000000', 'b4000000-0000-0000-0000-000000000001', 4);
select pg_temp.spend('20000004-0000-0000-0000-000000000000', pg_temp.balance('20000004-0000-0000-0000-000000000000'));
select pg_temp.keep('u4.spent', pg_temp.st('20000004-0000-0000-0000-000000000000'));
select throws_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4c', 4, 1)$$,
  'QX106', 'Those points were already spent', 'complete, spend, undo is refused');
select ok(exists (select 1 from public.habit_completions where id = pg_temp.c('u4c'))
          and pg_temp.st('20000004-0000-0000-0000-000000000000') = pg_temp.kept('u4.spent'),
  'and changes nothing');
select throws_ok($$select pg_temp.undo('20000004-0000-0000-0000-000000000000', 'u4c', 4, 16)$$,
  'QX104', null, 'the window is checked before the balance');

-- ── U2: milestones are revoked with the day ─────────────────────────────────
select pg_temp.done('u2d1', '20000002-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('u2d2', '20000002-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('u2.pre3', pg_temp.st('20000002-0000-0000-0000-000000000000'));
select is((pg_temp.done('u2d3', '20000002-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 3)
           ->> 'milestone')::int, 3,
  '(day 3 earns the 3-day milestone)');
-- Leave enough for the completion's points but not the milestone's too.
create temp table u2gap as
select pg_temp.balance('20000002-0000-0000-0000-000000000000')
       - ((select j ->> 'points_awarded' from done_ids where n = 'u2d3')::int + 24) as x;
select pg_temp.spend('20000002-0000-0000-0000-000000000000', x) from u2gap;
select throws_ok($$select pg_temp.undo('20000002-0000-0000-0000-000000000000', 'u2d3', 3, 1)$$,
  'QX106', null, 'the balance must cover the revoked milestone too');
select pg_temp.spend('20000002-0000-0000-0000-000000000000', -x) from u2gap;
create temp table r2 as
select pg_temp.undo('20000002-0000-0000-0000-000000000000', 'u2d3', 3, 2) as j;
select is(pg_temp.st('20000002-0000-0000-0000-000000000000'), pg_temp.kept('u2.pre3'),
  'undoing a milestone day restores the profile exactly, milestone points included');
select ok(not exists (select 1 from public.streak_milestones_awarded
                      where user_id = '20000002-0000-0000-0000-000000000000'),
  'the milestone row is deleted');
select ok(exists (select 1 from public.points_ledger m
                  join public.points_ledger u on u.ref_id = m.ref_id and u.reason = 'undo'
                  where m.user_id = '20000002-0000-0000-0000-000000000000'
                    and m.reason = 'streak_milestone' and u.delta = -m.delta),
  'an undo ledger entry reverses it, referencing the old milestone id');
select ok((select j -> 'milestones_revoked' = '[3]'::jsonb and (j ->> 'milestone_points_removed')::int = 25
           from r2),
  'the JSON names the revoked milestone and its points');
-- The exact JSON shape: every key, its type, integers as integers.
select is((select array_agg(k || ':' || jsonb_typeof(j -> k) order by k) from r2, jsonb_object_keys(j) as k),
  array['current_streak:number', 'habit_id:string', 'habit_streak:number', 'level:number',
        'lifetime_points:number', 'local_date:string', 'milestone_points_removed:number',
        'milestones_revoked:array', 'new_balance:number', 'points_removed:number', 'undone_id:string'],
  'the JSON has exactly these keys, with these types');
select is((select array_agg(k || ':' || jsonb_typeof(j -> k) order by k) from r1, jsonb_object_keys(j) as k),
  (select array_agg(k || ':' || jsonb_typeof(j -> k) order by k) from r2, jsonb_object_keys(j) as k),
  'the same keys and types when nothing was revoked');
select ok((select jsonb_typeof(j -> 'milestones_revoked' -> 0) = 'number'
                  and (j ->> 'habit_id')::uuid = 'b2000000-0000-0000-0000-000000000001'
                  and j ->> 'local_date' = to_char(pg_temp.day(3), 'YYYY-MM-DD')
                  and (j ->> 'undone_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  and (select bool_and(j ->> k ~ '^-?[0-9]+$')
                       from unnest(array['current_streak', 'habit_streak', 'level', 'lifetime_points',
                                         'milestone_points_removed', 'new_balance', 'points_removed']) as k)
           from r2),
  'milestones are numbers, the habit and day are the undone ones, and the numbers are integers');
select is((pg_temp.done('u2d3b', '20000002-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 3, 3)
           ->> 'milestone')::int, 3,
  'completing again re-awards the milestone');
select is((select count(distinct ref_id)::int from public.points_ledger
           where user_id = '20000002-0000-0000-0000-000000000000' and reason = 'streak_milestone'), 2,
  'with a fresh id, so the ledger''s once-per-ref index doesn''t collide');

-- ── U3: an undo gives a spent freeze back ───────────────────────────────────
select pg_temp.done('u3d1', '20000003-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('u3d2', '20000003-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('u3.pre4', pg_temp.st('20000003-0000-0000-0000-000000000000'));
select pg_temp.keep('u3.hpre4', pg_temp.hst('b3000000-0000-0000-0000-000000000001'));
select pg_temp.done('u3d4', '20000003-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 4);
select ok((select streak_freezes = 0 and current_streak = 3 from public.profiles
           where id = '20000003-0000-0000-0000-000000000000'),
  '(day 4 spends the freeze on day 3)');
select pg_temp.undo('20000003-0000-0000-0000-000000000000', 'u3d4', 4, 1);
select is(pg_temp.st('20000003-0000-0000-0000-000000000000'), pg_temp.kept('u3.pre4'),
  'undoing it restores the freeze and the streak exactly');
select is(pg_temp.hst('b3000000-0000-0000-0000-000000000001'), pg_temp.kept('u3.hpre4'),
  'and the per-habit streak (current, longest, last date)');

-- ── U6: a day that is no longer the latest counted day (M1) ─────────────────
-- Day 1 at 23:50, day 2 at 00:01; then the time seam puts "now" back on
-- day 1, as a move west would, and day 1's completion is undone. Day 2's
-- streak was built on day 1, so emptying day 1 is refused (QX108).
select pg_temp.done('u6d1', '20000006-0000-0000-0000-000000000000', 'b6000000-0000-0000-0000-000000000001', 1, 710);
select pg_temp.done('u6d2', '20000006-0000-0000-0000-000000000000', 'b6000000-0000-0000-0000-000000000001', 1, 721);
select is((select current_streak from public.profiles where id = '20000006-0000-0000-0000-000000000000'), 2,
  '(two days counted)');
select pg_temp.keep('u6.st', pg_temp.st('20000006-0000-0000-0000-000000000000'));
select pg_temp.keep('u6.h', pg_temp.hst('b6000000-0000-0000-0000-000000000001'));
select throws_ok($$select pg_temp.undo('20000006-0000-0000-0000-000000000000', 'u6d1', 1, 715)$$,
  'QX108', 'A later day already counts on this one',
  'emptying a day a later counted day was built on is refused');
select is(pg_temp.st('20000006-0000-0000-0000-000000000000'), pg_temp.kept('u6.st'),
  'and the profile is unchanged');
select ok(pg_temp.hst('b6000000-0000-0000-0000-000000000001') = pg_temp.kept('u6.h')
          and exists (select 1 from public.habit_completions where id = pg_temp.c('u6d1')),
  'as are the habit streak and the completion');

-- ── U7: the client wrapper uses the JWT and now() ───────────────────────────
select pg_temp.as_user('20000007-0000-0000-0000-000000000000');
select public.complete_habit('b7000000-0000-0000-0000-000000000001');
select pg_temp.as_postgres();
select set_config('qx.cid', (select id::text from public.habit_completions
                             where user_id = '20000007-0000-0000-0000-000000000000'), true);
select pg_temp.as_user('20000005-0000-0000-0000-000000000000');
select throws_ok($$select public.undo_completion(current_setting('qx.cid')::uuid)$$,
  'P0002', 'Completion not found', 'a client can''t undo someone else''s completion');
select pg_temp.as_user('20000007-0000-0000-0000-000000000000');
select is((public.undo_completion(current_setting('qx.cid')::uuid) ->> 'new_balance')::int, 0,
  'a client undoes its own completion');
select pg_temp.as_postgres();
select ok(not exists (select 1 from public.habit_completions where user_id = '20000007-0000-0000-0000-000000000000'),
  '(it is gone)');
select set_config('role', 'service_role', true);
select throws_ok($$select public.undo_completion(gen_random_uuid())$$,
  '42501', null, 'service_role calling undo_completion is refused');
select pg_temp.as_postgres();

-- ── U8: complete → undo → complete can't farm points or milestones ─────────
select pg_temp.done('u8d1', '20000008-0000-0000-0000-000000000000', 'b8000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('u8d2', '20000008-0000-0000-0000-000000000000', 'b8000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('u8.pre3', pg_temp.st('20000008-0000-0000-0000-000000000000'));
select pg_temp.done('u8d3', '20000008-0000-0000-0000-000000000000', 'b8000000-0000-0000-0000-000000000001', 3);
select pg_temp.keep('u8.post3', pg_temp.st('20000008-0000-0000-0000-000000000000'));
select pg_temp.keep('u8.hpost3', pg_temp.hst('b8000000-0000-0000-0000-000000000001'));
create temp table u8first as select j from done_ids where n = 'u8d3';
do $$
begin
  for i in 1..3 loop
    perform pg_temp.undo('20000008-0000-0000-0000-000000000000', 'u8d3', 3, 2 * i - 1);
    perform pg_temp.done('u8d3', '20000008-0000-0000-0000-000000000000',
                         'b8000000-0000-0000-0000-000000000001', 3, 2 * i);
  end loop;
end $$;
select is(pg_temp.st('20000008-0000-0000-0000-000000000000'), pg_temp.kept('u8.post3'),
  'three undo/redo loops on a milestone day leave balance, lifetime and streak as one completion did');
select is(pg_temp.hst('b8000000-0000-0000-0000-000000000001'), pg_temp.kept('u8.hpost3'),
  'and the habit streak');
select is((select (d.j ->> 'points_awarded')::int || '/' || (d.j ->> 'milestone') from done_ids d where d.n = 'u8d3'),
          (select (f.j ->> 'points_awarded')::int || '/' || (f.j ->> 'milestone') from u8first f),
  'a redo earns the same points and the same milestone as the first completion');
select is((select count(*)::int from public.streak_milestones_awarded
           where user_id = '20000008-0000-0000-0000-000000000000'), 1,
  'one milestone row, not one per loop');
select is((select count(*)::int from public.points_ledger
           where user_id = '20000008-0000-0000-0000-000000000000' and reason = 'undo'), 6,
  'each undo books one entry for the completion and one for the milestone');
select ok(not exists (select 1 from public.points_ledger
                      where user_id = '20000008-0000-0000-0000-000000000000'
                      group by reason, ref_id having count(*) > 1),
  'no (reason, ref) pair repeats across the loops');
select set_config('qx.ref', (select ref_id::text from public.points_ledger
                             where user_id = '20000008-0000-0000-0000-000000000000' and reason = 'undo'
                             order by id limit 1), true);
select throws_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
                   values ('20000008-0000-0000-0000-000000000000', -1, 'undo', current_setting('qx.ref')::uuid)$$,
  '23505', null, 'a second undo entry for the same completion is refused by the ledger');
select pg_temp.undo('20000008-0000-0000-0000-000000000000', 'u8d3', 3, 7);
select is(pg_temp.st('20000008-0000-0000-0000-000000000000'), pg_temp.kept('u8.pre3'),
  'a final undo restores the state before the milestone day exactly');

-- ── U9: undo/redo on a freeze day can't gain freezes ────────────────────────
select pg_temp.done('u9d1', '20000009-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('u9d2', '20000009-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('u9.pre4', pg_temp.st('20000009-0000-0000-0000-000000000000'));
select pg_temp.keep('u9.hpre4', pg_temp.hst('b9000000-0000-0000-0000-000000000001'));
select pg_temp.done('u9d4', '20000009-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-000000000001', 4);
select pg_temp.keep('u9.post4', pg_temp.st('20000009-0000-0000-0000-000000000000'));
do $$
begin
  for i in 1..3 loop
    perform pg_temp.undo('20000009-0000-0000-0000-000000000000', 'u9d4', 4, 2 * i - 1);
    perform pg_temp.done('u9d4', '20000009-0000-0000-0000-000000000000',
                         'b9000000-0000-0000-0000-000000000001', 4, 2 * i);
  end loop;
end $$;
select ok((select streak_freezes = 0 and current_streak = 3 and longest_streak = 3 from public.profiles
           where id = '20000009-0000-0000-0000-000000000000'),
  'each redo spends the returned freeze again: no freeze or streak gain');
select is(pg_temp.st('20000009-0000-0000-0000-000000000000'), pg_temp.kept('u9.post4'),
  'the loops leave the state exactly as one completion did');
select pg_temp.undo('20000009-0000-0000-0000-000000000000', 'u9d4', 4, 7);
select is(pg_temp.st('20000009-0000-0000-0000-000000000000'), pg_temp.kept('u9.pre4'),
  'a final undo gives back exactly one freeze');
select is(pg_temp.hst('b9000000-0000-0000-0000-000000000001'), pg_temp.kept('u9.hpre4'),
  'and the habit streak');

-- ── V1: undoing a day that reset the streak ─────────────────────────────────
select pg_temp.done('v1d1', '21000001-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('v1d2', '21000001-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('v1.pre5', pg_temp.st('21000001-0000-0000-0000-000000000000'));
select pg_temp.keep('v1.hpre5', pg_temp.hst('c1000000-0000-0000-0000-000000000001'));
select pg_temp.done('v1d5', '21000001-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 5);
select ok((select current_streak = 1 and longest_streak = 2 and streak_run_started = pg_temp.day(5)
           from public.profiles where id = '21000001-0000-0000-0000-000000000000'),
  '(day 5, after two missed days and no freeze, resets the streak)');
create temp table rv1 as
select pg_temp.undo('21000001-0000-0000-0000-000000000000', 'v1d5', 5, 1) as j;
select is(pg_temp.st('21000001-0000-0000-0000-000000000000'), pg_temp.kept('v1.pre5'),
  'undoing a reset day restores the old run (streak, last date, run start) exactly');
select is(pg_temp.hst('c1000000-0000-0000-0000-000000000001'), pg_temp.kept('v1.hpre5'),
  'and the old habit streak');
select is((select (j ->> 'current_streak')::int from rv1), 2, 'the JSON reports the restored streak');
select pg_temp.done('v1d5b', '21000001-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 5, 2);
select ok((select current_streak = 1 and longest_streak = 2 and streak_run_started = pg_temp.day(5)
           from public.profiles where id = '21000001-0000-0000-0000-000000000000'),
  'redoing it resets the streak again');

-- ── V2: target 3, a non-last occurrence undone over a prior habit streak ────
select pg_temp.done('v2a' || i, '21000002-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-000000000003', 1, i)
from generate_series(1, 3) as i;
select pg_temp.keep('v2.post1', pg_temp.st('21000002-0000-0000-0000-000000000000'));
select pg_temp.keep('v2.hpost1', pg_temp.hst('c2000000-0000-0000-0000-000000000003'));
select pg_temp.done('v2b' || i, '21000002-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-000000000003', 2, i)
from generate_series(1, 3) as i;
select pg_temp.keep('v2.hpost2', pg_temp.hst('c2000000-0000-0000-0000-000000000003'));
select is((select current from public.habit_streaks where habit_id = 'c2000000-0000-0000-0000-000000000003'), 2,
  '(two days at target: habit streak 2)');
create temp table rv2 as
select pg_temp.undo('21000002-0000-0000-0000-000000000000', 'v2b1', 2, 4) as j;
select is(pg_temp.hst('c2000000-0000-0000-0000-000000000003'), pg_temp.kept('v2.hpost1'),
  'undoing occurrence 1 of 3 after the target restores the previous day''s habit streak exactly');
select is((select (j ->> 'habit_streak')::int from rv2), 1, 'the JSON reports the restored habit streak');
select ok((select current_streak = 2 and last_streak_date = pg_temp.day(2) from public.profiles
           where id = '21000002-0000-0000-0000-000000000000'),
  'the day still counts for the global streak');
select is((pg_temp.done('v2b1b', '21000002-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-000000000003', 2, 5)
           ->> 'habit_streak')::int, 2,
  'reaching the target again advances the habit streak to 2, once');
select is(pg_temp.hst('c2000000-0000-0000-0000-000000000003'), pg_temp.kept('v2.hpost2'),
  '(exactly as before the undo)');
select pg_temp.undo('21000002-0000-0000-0000-000000000000', 'v2b2', 2, 6);
select is(pg_temp.hst('c2000000-0000-0000-0000-000000000003'), pg_temp.kept('v2.hpost1'),
  'undoing the middle occurrence restores it too');
select pg_temp.undo('21000002-0000-0000-0000-000000000000', 'v2b3', 2, 7);
select is(pg_temp.hst('c2000000-0000-0000-0000-000000000003'), pg_temp.kept('v2.hpost1'),
  'a further undo below the target leaves the restored state alone');
select pg_temp.undo('21000002-0000-0000-0000-000000000000', 'v2b1b', 2, 8);
select is(pg_temp.st('21000002-0000-0000-0000-000000000000'), pg_temp.kept('v2.post1'),
  'emptying the day restores the profile to the previous day''s end state');

-- ── V3: two habits on a milestone day ───────────────────────────────────────
select pg_temp.done('v3d1', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('v3d2', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 2);
select pg_temp.keep('v3.pre3', pg_temp.st('21000003-0000-0000-0000-000000000000'));
select is((pg_temp.done('v3a', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 3)
           ->> 'milestone')::int, 3,
  '(the day''s first completion earns the 3-day milestone)');
select pg_temp.done('v3b', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000002', 3, 1);
create temp table rv3a as
select pg_temp.undo('21000003-0000-0000-0000-000000000000', 'v3a', 3, 2) as j;
select ok((select j -> 'milestones_revoked' = '[]'::jsonb and (j ->> 'milestone_points_removed')::int = 0
                  and (j ->> 'current_streak')::int = 3
           from rv3a)
          and (select count(*) = 1 from public.streak_milestones_awarded
               where user_id = '21000003-0000-0000-0000-000000000000'),
  'undoing the milestone''s own completion keeps the milestone while another completion holds the day');
create temp table rv3b as
select pg_temp.undo('21000003-0000-0000-0000-000000000000', 'v3b', 3, 3) as j;
select ok((select j -> 'milestones_revoked' = '[3]'::jsonb and (j ->> 'milestone_points_removed')::int = 25
           from rv3b),
  'undoing the last completion revokes it');
select is(pg_temp.st('21000003-0000-0000-0000-000000000000'), pg_temp.kept('v3.pre3'),
  'and restores the profile exactly');

-- ── V4: a balance exactly covering points and milestone is enough ──────────
select pg_temp.done('v4d1', '21000004-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('v4d2', '21000004-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-000000000001', 2);
select pg_temp.done('v4d3', '21000004-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-000000000001', 3);
select pg_temp.spend('21000004-0000-0000-0000-000000000000',
  pg_temp.balance('21000004-0000-0000-0000-000000000000')
  - ((select j ->> 'points_awarded' from done_ids where n = 'v4d3')::int + 25));
select is((pg_temp.undo('21000004-0000-0000-0000-000000000000', 'v4d3', 3, 1) ->> 'new_balance')::int, 0,
  'a balance of exactly the points plus the milestone can be undone, to zero');

-- ── V5: undoing D, then D+1, across midnight (M1) ───────────────────────────
-- D3 at 23:50 earns the 3-day milestone, D4 at 00:01 counts. The time seam
-- puts "now" back on D3 (a move west): undoing D3's completion is refused,
-- because D4 was built on it. D4's own undo at 00:05 then restores D3's end.
select pg_temp.done('v5d1', '21000005-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 1);
select pg_temp.done('v5d2', '21000005-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 2);
select pg_temp.done('v5d3', '21000005-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 3, 710);
select pg_temp.keep('v5.pre4', pg_temp.st('21000005-0000-0000-0000-000000000000'));
select pg_temp.keep('v5.hpre4', pg_temp.hst('c5000000-0000-0000-0000-000000000001'));
select pg_temp.done('v5d4', '21000005-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 3, 721);
select throws_ok($$select pg_temp.undo('21000005-0000-0000-0000-000000000000', 'v5d3', 3, 715)$$,
  'QX108', null, 'undoing D after D+1 counted on it is refused (M1)');
select pg_temp.undo('21000005-0000-0000-0000-000000000000', 'v5d4', 3, 725);
select is(pg_temp.st('21000005-0000-0000-0000-000000000000'), pg_temp.kept('v5.pre4'),
  'undoing D+1 restores D''s end state exactly, milestone included');
select is(pg_temp.hst('c5000000-0000-0000-0000-000000000001'), pg_temp.kept('v5.hpre4'),
  'and the habit streak');
select ok(not exists (
  select 1 from public.streak_milestones_awarded m
  where m.user_id = '21000005-0000-0000-0000-000000000000'
    and not exists (select 1 from public.habit_completions c
                    where c.user_id = m.user_id and c.local_date = m.awarded_on)),
  'no milestone survives on a day with no completion');
select is((pg_temp.done('v5d4b', '21000005-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 3, 726)
           ->> 'current_streak')::int, 4,
  'redoing D+1 continues the streak from D, which still has its completion');

-- ── V3 again: a per-habit streak a later day built on (QX108) ───────────────
-- Day 10 at 23:50 completes both habits; day 11 at 00:01 completes "Read"
-- again. Back on day 10, undoing day 10's "Read" doesn't empty the day, but
-- it would drop "Read" below target under day 11's habit streak.
select pg_temp.done('v3r10', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000002', 10, 710);
select pg_temp.done('v3d10', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 10, 711);
select pg_temp.done('v3r11', '21000003-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000002', 10, 721);
select throws_ok($$select pg_temp.undo('21000003-0000-0000-0000-000000000000', 'v3r10', 10, 715)$$,
  'QX108', 'A later day already counts on this one',
  'dropping a day below target under a later day''s habit streak is refused');

-- ── V6: a sibling completion's saved habit state, made stale by an undo ─────
-- Target 2. D1 reaches it at 23:45; D2's first completion at 00:01 saves
-- (1, 1, D1). Back on D1, an undo drops D1 below target and deletes the
-- streak; D2 then reaches the target afresh, and D2's first completion is
-- undone. Neither day reached the target, so no habit streak may remain.
select pg_temp.done('v6a1', '21000006-0000-0000-0000-000000000000', 'c6000000-0000-0000-0000-000000000002', 1, 700);
select pg_temp.done('v6a2', '21000006-0000-0000-0000-000000000000', 'c6000000-0000-0000-0000-000000000002', 1, 705);
select pg_temp.done('v6b1', '21000006-0000-0000-0000-000000000000', 'c6000000-0000-0000-0000-000000000002', 1, 721);
select pg_temp.undo('21000006-0000-0000-0000-000000000000', 'v6a2', 1, 715);
select is(pg_temp.hst('c6000000-0000-0000-0000-000000000002'), 'none',
  '(undoing D1 below its target deletes the habit streak)');
select pg_temp.done('v6b2', '21000006-0000-0000-0000-000000000000', 'c6000000-0000-0000-0000-000000000002', 1, 722);
select pg_temp.undo('21000006-0000-0000-0000-000000000000', 'v6b1', 1, 723);
select is(pg_temp.hst('c6000000-0000-0000-0000-000000000002'), 'none',
  'undoing D2''s first completion doesn''t restore a streak for a day that no longer reached its target');

-- ── Invariants ──────────────────────────────────────────────────────────────
select ok(bool_and(pg_temp.balance_ok(id)), 'every user''s balance and lifetime match the ledger')
from public.profiles where pg_temp.mine(id);
select ok(not exists (
  select 1 from public.daily_progress d
  where pg_temp.mine(d.user_id)
    and d.completed_count <> (select count(*) from public.habit_completions c
                              where c.user_id = d.user_id and c.local_date = d.local_date)),
  'every day''s completed_count matches its completions');
select ok(not exists (
  select 1 from public.daily_progress d
  where pg_temp.mine(d.user_id) and d.counted_for_streak and d.completed_count = 0),
  'no empty day is still counted');
select ok(not exists (
  select 1 from public.profiles p
  where pg_temp.mine(p.id) and p.last_streak_date is not null
    and not exists (select 1 from public.habit_completions c
                    where c.user_id = p.id and c.local_date = p.last_streak_date)),
  'every streak ends on a day with a completion');
select ok(not exists (
  select 1 from public.habit_streaks hs
  join public.daily_schedule_habits sh
    on sh.user_id = hs.user_id and sh.habit_id = hs.habit_id and sh.local_date = hs.last_date
  where pg_temp.mine(hs.user_id)
    and (select count(*) from public.habit_completions c
         where c.habit_id = hs.habit_id and c.local_date = hs.last_date) < sh.target_per_day),
  'every habit streak ends on a day that reached its target');
select lives_ok($$set constraints all immediate$$, 'deferred FKs hold');
select * from finish();
rollback;
