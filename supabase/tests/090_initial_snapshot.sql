-- Phase 4 (#82): archive/unarchive cycling must not make every day optional.
-- A habit that joins a day after its first snapshot earns points but doesn't
-- count the day for the global streak. Real now(): the habit triggers use it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
create function pg_temp.u(n int) returns uuid language sql as $$
  select ('5000000' || n || '-0000-0000-0000-000000000000')::uuid $$;
-- Habit m of user n.
create function pg_temp.h(n int, m int) returns uuid language sql as $$
  select ('c00000' || n || m || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.d() returns date language sql as $$
  select public.local_date_in('UTC', now()) $$;
create function pg_temp.prof(n int) returns public.profiles language sql as $$
  select * from public.profiles where id = pg_temp.u(n) $$;
create function pg_temp.counted(n int) returns boolean language sql as $$
  select coalesce((select counted_for_streak from public.daily_progress
                   where user_id = pg_temp.u(n) and local_date = pg_temp.d()), false) $$;
create function pg_temp.late(j jsonb, p_habit uuid) returns boolean language sql as $$
  select (h ->> 'joined_late')::boolean from jsonb_array_elements(j -> 'habits') h
  where (h ->> 'id')::uuid = p_habit $$;
create function pg_temp.unarchive(n int, m int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.u(n));
  perform public.unarchive_habit(pg_temp.h(n, m));
  perform pg_temp.as_postgres();
end $$;
create function pg_temp.balance_ok(n int) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = pg_temp.u(n))
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = pg_temp.u(n)) $$;

-- A1 the exploit · A2 an initial habit still counts the day · A3 a habit
-- created mid-day · A4 undo · A5 a broken streak isn't paid · A6 structure.
-- Habits are created and archived before onboarding, so nothing snapshots
-- until the first get_today.
insert into auth.users (id, email)
select pg_temp.u(g), 'a' || g || '@example.com' from generate_series(1, 5) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select pg_temp.h(g, m), pg_temp.u(g), 'Habit ' || m, 'mind', 'medium', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'
from generate_series(1, 5) as g, generate_series(1, 2) as m;
-- Habit 1 is archived for users 1, 2, 4 and 5; habit 2 for users 1, 4 and 5.
update public.habits set archived_at = now() - interval '10 days'
  where (id = any (array[pg_temp.h(1, 1), pg_temp.h(1, 2), pg_temp.h(2, 1),
                         pg_temp.h(4, 1), pg_temp.h(4, 2), pg_temp.h(5, 1), pg_temp.h(5, 2)]));
update public.profiles set onboarded_at = now() - interval '30 days'
  where id in (select pg_temp.u(g) from generate_series(1, 5) as g);
-- A 2-day streak ending yesterday (stands in for earlier days).
update public.profiles
   set current_streak = 2, longest_streak = 2, last_streak_date = pg_temp.d() - 1,
       streak_run_started = pg_temp.d() - 2
 where id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4));
-- User 5's streak ended 3 days ago; the days since were scheduled (missed).
update public.profiles
   set current_streak = 5, longest_streak = 5, last_streak_date = pg_temp.d() - 3,
       streak_run_started = pg_temp.d() - 7
 where id = pg_temp.u(5);
insert into public.daily_schedule (user_id, local_date, scheduled_count)
select pg_temp.u(5), pg_temp.d() - g, 1 from generate_series(1, 2) as g;

-- ── A1: everything archived, then one habit unarchived (the exploit) ────────
select is((public.get_today_at(pg_temp.u(1), now()) ->> 'scheduled_count')::int, 0,
  '(with everything archived, today is a rest day)');
select pg_temp.unarchive(1, 1);
create temp table g1 as select public.get_today_at(pg_temp.u(1), now()) as j;
select ok(pg_temp.late((select j from g1), pg_temp.h(1, 1)),
  'get_today marks the unarchived habit as joined_late');
create temp table a1 as select public.complete_habit_at(pg_temp.u(1), pg_temp.h(1, 1), now()) as j;
select ok(((select j from a1) ->> 'points_awarded')::int > 0, 'completing it earns points');
select ok((pg_temp.prof(1)).current_streak = 2 and (pg_temp.prof(1)).last_streak_date = pg_temp.d() - 1,
  'but the streak doesn''t grow');
select ok(not pg_temp.counted(1), 'and the day stays uncounted');
select is(((select j from a1) ->> 'current_streak')::int, 2,
  'the completion reports the streak as judged today');
select is(((select j from a1) ->> 'multiplier')::numeric,
  round(1 + 2 * (public.economy_value('multiplier_step'))::numeric, 2),
  'and pays the judged streak''s multiplier (no day added)');
select ok(not exists (select 1 from public.streak_milestones_awarded where user_id = pg_temp.u(1)),
  'no milestone (counting would have reached 3)');
select ok(pg_temp.balance_ok(1), 'the ledger matches');

-- ── A2: an initial habit still counts the day ───────────────────────────────
-- Habit 2 is active and in the first snapshot; habit 1 joins later.
select public.get_today_at(pg_temp.u(2), now());
select pg_temp.unarchive(2, 1);
create temp table g2 as select public.get_today_at(pg_temp.u(2), now()) as j;
select ok(not pg_temp.late((select j from g2), pg_temp.h(2, 2)) and pg_temp.late((select j from g2), pg_temp.h(2, 1)),
  'the snapshotted habit is initial, the unarchived one joined late');
select public.complete_habit_at(pg_temp.u(2), pg_temp.h(2, 1), now());
select ok(not pg_temp.counted(2), '(the late habit doesn''t count the day)');
select is((public.complete_habit_at(pg_temp.u(2), pg_temp.h(2, 2), now()) ->> 'current_streak')::int, 3,
  'completing the initial habit then counts it');
select ok(pg_temp.counted(2) and (pg_temp.prof(2)).last_streak_date = pg_temp.d(), '(counted today)');

-- ── A3: a habit created mid-day (the accepted trade-off) ────────────────────
select public.get_today_at(pg_temp.u(3), now());
insert into public.habits (user_id, title, category) values (pg_temp.u(3), 'New', 'mind');
select ok(pg_temp.late(public.get_today_at(pg_temp.u(3), now()), (select id from public.habits where user_id = pg_temp.u(3) and title = 'New')),
  'a habit created after the day''s first snapshot joined late');
select public.complete_habit_at(pg_temp.u(3), (select id from public.habits where user_id = pg_temp.u(3) and title = 'New'), now());
select ok((pg_temp.prof(3)).current_streak = 2 and not pg_temp.counted(3),
  'its completion doesn''t count the day');

-- ── A4: undo of a late completion ───────────────────────────────────────────
select public.get_today_at(pg_temp.u(4), now());
select pg_temp.unarchive(4, 1);
create temp table a4 as
  select (pg_temp.prof(4)).points_balance as bal,
         public.complete_habit_at(pg_temp.u(4), pg_temp.h(4, 1), now()) as j;
select lives_ok($$select public.undo_completion_at(pg_temp.u(4), ((select j from a4) ->> 'completion_id')::uuid, now())$$,
  'a late completion can be undone');
select ok((pg_temp.prof(4)).points_balance = (select bal from a4) and (pg_temp.prof(4)).current_streak = 2
          and pg_temp.balance_ok(4) and not pg_temp.counted(4),
  'undo gives back the points; the streak and the day are untouched');

-- ── A5: with no live streak, a late joiner counts the day (it can only ────
-- start a run at 1; review of PR #94)
select public.get_today_at(pg_temp.u(5), now());
select pg_temp.unarchive(5, 1);
create temp table a5 as select public.complete_habit_at(pg_temp.u(5), pg_temp.h(5, 1), now()) as j;
select ok(((select j from a5) ->> 'current_streak')::int = 1
          and ((select j from a5) ->> 'multiplier')::numeric = round(1 + (public.economy_value('multiplier_step'))::numeric, 2),
  'two missed days and no freezes: the late completion starts a new run at 1, at the base multiplier');
select ok((pg_temp.prof(5)).current_streak = 1 and (pg_temp.prof(5)).streak_run_started = pg_temp.d()
          and pg_temp.counted(5),
  '(the day counts: there was no live streak to protect)');

-- ── A7: a new user's first day (onboarding snapshots before any habit) ─────
-- Onboarding sets onboarded_at, then step 2 adds habits: today's first
-- snapshot is empty and every first-day habit joins late.
insert into auth.users (id, email) values (pg_temp.u(6), 'a6@example.com');
update public.profiles set onboarded_at = now() where id = pg_temp.u(6);
insert into public.habits (user_id, title, category) values (pg_temp.u(6), 'First', 'mind');
create temp table a7 as
  select public.complete_habit_at(pg_temp.u(6),
           (select id from public.habits where user_id = pg_temp.u(6)), now()) as j;
select ok(((select j from a7) ->> 'current_streak')::int = 1 and pg_temp.counted(6)
          and (pg_temp.prof(6)).last_streak_date = pg_temp.d(),
  'a new user''s first completion on onboarding day starts the streak at 1');

-- ── A8: undo on a day a late joiner counted (no live streak) ───────────────
-- A new user's first day: A and B both join late. A counts the day (a run
-- at 1); undoing B must leave it counted, since A could count it alone.
insert into auth.users (id, email) values (pg_temp.u(7), 'a7@example.com');
update public.profiles set onboarded_at = now() where id = pg_temp.u(7);
insert into public.habits (user_id, title, category) values (pg_temp.u(7), 'A', 'mind'), (pg_temp.u(7), 'B', 'mind');
create function pg_temp.h7(t text) returns uuid language sql as $$
  select id from public.habits where user_id = pg_temp.u(7) and title = t $$;
create temp table a8 as
  select 'A' as t, public.complete_habit_at(pg_temp.u(7), pg_temp.h7('A'), now()) as j
  union all select 'B', public.complete_habit_at(pg_temp.u(7), pg_temp.h7('B'), now());
select public.undo_completion_at(pg_temp.u(7), ((select j from a8 where t = 'B') ->> 'completion_id')::uuid, now());
select ok((pg_temp.prof(7)).current_streak = 1 and (pg_temp.prof(7)).last_streak_date = pg_temp.d()
          and pg_temp.counted(7),
  'undoing one late completion keeps a day another late completion counted (review of PR #94)');
select public.undo_completion_at(pg_temp.u(7), ((select j from a8 where t = 'A') ->> 'completion_id')::uuid, now());
select ok((pg_temp.prof(7)).current_streak = 0 and (pg_temp.prof(7)).last_streak_date is null
          and not pg_temp.counted(7) and pg_temp.balance_ok(7),
  'undoing the last one restores the day');

-- ── A6: structure ───────────────────────────────────────────────────────────
select col_not_null('public', 'daily_schedule_habits', 'initial', 'initial is NOT NULL');
select col_default_is('public', 'daily_schedule_habits', 'initial', 'false',
  'it defaults to false (fail closed): only ensure_daily_schedule writes true');
select ok(not exists (select 1 from public.daily_schedule_habits
                      where user_id = pg_temp.u(2) and habit_id = pg_temp.h(2, 1) and initial),
  'snapshot_add_habit rows are not initial');

select * from finish();
rollback;
