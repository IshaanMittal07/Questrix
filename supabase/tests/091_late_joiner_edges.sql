-- Phase 4 (#82): edges of the late-joiner rule (090 covers the exploit).
-- Rescheduling onto today, archive/unarchive of an initial habit, undo when
-- late and initial completions share a day, freezes, milestones, per-habit
-- streaks, relived days, the next day and at_risk. Real now(): the habit
-- triggers use it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

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
  select ('5100000' || n || '-0000-0000-0000-000000000000')::uuid $$;
-- Habit m of user n: 1 is in the day's first snapshot, 2 joins late.
create function pg_temp.h(n int, m int) returns uuid language sql as $$
  select ('c10000' || n || m || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.d() returns date language sql as $$
  select public.local_date_in('UTC', now()) $$;
-- 23:00 UTC today: after the at_risk hour, still today.
create function pg_temp.evening() returns timestamptz language sql as $$
  select (pg_temp.d() + time '23:00') at time zone 'UTC' $$;
create function pg_temp.prof(n int) returns public.profiles language sql as $$
  select * from public.profiles where id = pg_temp.u(n) $$;
create function pg_temp.counted(n int, p_day date default null) returns boolean language sql as $$
  select coalesce((select counted_for_streak from public.daily_progress
                   where user_id = pg_temp.u(n) and local_date = coalesce(p_day, pg_temp.d())), false) $$;
create function pg_temp.initial(n int, m int, p_day date default null) returns boolean language sql as $$
  select sh.initial from public.daily_schedule_habits sh
  where sh.user_id = pg_temp.u(n) and sh.habit_id = pg_temp.h(n, m)
    and sh.local_date = coalesce(p_day, pg_temp.d()) $$;
create function pg_temp.late(j jsonb, p_habit uuid) returns boolean language sql as $$
  select (h ->> 'joined_late')::boolean from jsonb_array_elements(j -> 'habits') h
  where (h ->> 'id')::uuid = p_habit $$;
create function pg_temp.unarchive(n int, m int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.u(n));
  perform public.unarchive_habit(pg_temp.h(n, m));
  perform pg_temp.as_postgres();
end $$;
create function pg_temp.archive(n int, m int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.u(n));
  perform public.archive_habit(pg_temp.h(n, m));
  perform pg_temp.as_postgres();
end $$;
create function pg_temp.set_days(n int, m int, p_days smallint[]) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.u(n));
  update public.habits set days_of_week = p_days where id = pg_temp.h(n, m);
  perform pg_temp.as_postgres();
end $$;
create function pg_temp.done(n int, m int, p_now timestamptz default now()) returns jsonb language sql as $$
  select public.complete_habit_at(pg_temp.u(n), pg_temp.h(n, m), p_now) $$;
create function pg_temp.undo(n int, p_c jsonb) returns jsonb language sql as $$
  select public.undo_completion_at(pg_temp.u(n), (p_c ->> 'completion_id')::uuid, now()) $$;
create function pg_temp.mult(p_streak int) returns numeric language sql as $$
  select round(1 + (public.economy_value('multiplier_step'))::numeric * p_streak, 2) $$;
create function pg_temp.balance_ok(n int) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = pg_temp.u(n))
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = pg_temp.u(n)) $$;
create temp table c (k text primary key, j jsonb);
create function pg_temp.keep(p_k text, p_j jsonb) returns jsonb language sql as $$
  insert into c values (p_k, p_j) returning j $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$
  select j from c where k = p_k $$;

-- Users 0-9. Every user has habit 1 (daily, medium) and habit 2 (daily, medium; user 7:
-- target 2), created and onboarded 30 days ago. Habit 2 is archived for
-- every user but 1, whose habit 2 is instead not scheduled on today's
-- weekday. Nothing snapshots until the first get_today.
insert into auth.users (id, email)
select pg_temp.u(g), 'l' || g || '@example.com' from generate_series(0, 9) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select pg_temp.h(g, m), pg_temp.u(g), 'Habit ' || m, 'mind', 'medium',
       case when g = 1 and m = 2
            then array(select x::smallint from generate_series(0, 6) x
                       where x <> extract(dow from pg_temp.d())::int)
            else '{0,1,2,3,4,5,6}'::smallint[] end,
       case when g = 7 and m = 2 then 2 else 1 end,
       now() - interval '30 days'
from generate_series(0, 9) as g, generate_series(1, 2) as m;
update public.habits set archived_at = now() - interval '10 days'
 where id in (select pg_temp.h(g, 2) from generate_series(0, 9) as g where g <> 1);
update public.profiles set onboarded_at = now() - interval '30 days'
 where id in (select pg_temp.u(g) from generate_series(0, 9) as g);
-- A 2-day streak ending yesterday.
update public.profiles
   set current_streak = 2, longest_streak = 2, last_streak_date = pg_temp.d() - 1,
       streak_run_started = pg_temp.d() - 2
 where id in (select pg_temp.u(g) from generate_series(0, 9) as g);
select public.get_today_at(pg_temp.u(g), now()) from generate_series(0, 9) as g;

-- ── B1: rescheduled onto today ──────────────────────────────────────────────
select is(pg_temp.initial(1, 2), null, '(habit 2 isn''t in today''s snapshot)');
select pg_temp.set_days(1, 2, '{0,1,2,3,4,5,6}');
select ok(pg_temp.initial(1, 2) is false
          and pg_temp.late(public.get_today_at(pg_temp.u(1), now()), pg_temp.h(1, 2)),
  'a habit rescheduled onto today joins late');
select pg_temp.keep('b1', pg_temp.done(1, 2));
select ok((pg_temp.got('b1') ->> 'current_streak')::int = 2 and (pg_temp.prof(1)).current_streak = 2
          and not pg_temp.counted(1),
  'and its completion doesn''t count the day');
-- Rescheduling an initial habit away from today and back keeps it initial.
select pg_temp.set_days(1, 1, array(select x::smallint from generate_series(0, 6) x
                                    where x <> extract(dow from pg_temp.d())::int));
select pg_temp.set_days(1, 1, '{0,1,2,3,4,5,6}');
select ok(pg_temp.initial(1, 1), 'an initial habit rescheduled away from today and back stays initial');
select is((pg_temp.done(1, 1) ->> 'current_streak')::int, 3, '(and still counts the day)');

-- ── B2: archive and unarchive an initial habit ──────────────────────────────
select pg_temp.archive(2, 1);
select pg_temp.unarchive(2, 1);
select ok(pg_temp.initial(2, 1) and not pg_temp.late(public.get_today_at(pg_temp.u(2), now()), pg_temp.h(2, 1)),
  'archiving and unarchiving an initial habit the same day keeps it initial');
select ok((pg_temp.done(2, 1) ->> 'current_streak')::int = 3 and pg_temp.counted(2),
  '(its completion still counts the day)');

-- ── B3: late, then initial, then the initial one is undone ──────────────────
select pg_temp.unarchive(3, 2);
select pg_temp.keep('b3 late', pg_temp.done(3, 2));
select pg_temp.keep('b3 initial', pg_temp.done(3, 1));
select ok((pg_temp.prof(3)).current_streak = 3 and pg_temp.counted(3),
  '(the initial completion counts the day)');
select pg_temp.undo(3, pg_temp.got('b3 initial'));
select ok((pg_temp.prof(3)).current_streak = 2 and (pg_temp.prof(3)).last_streak_date = pg_temp.d() - 1,
  'undoing the only initial completion restores the streak, though a late one remains');
select ok(not pg_temp.counted(3), 'and leaves the day uncounted');
select ok(exists (select 1 from public.habit_completions
                  where id = (pg_temp.got('b3 late') ->> 'completion_id')::uuid)
          and pg_temp.balance_ok(3),
  '(the late completion and its points stay)');
select pg_temp.keep('b3 initial 2', pg_temp.done(3, 1));
select ok((pg_temp.prof(3)).current_streak = 3 and pg_temp.counted(3),
  'completing the initial habit again counts the day once');
select pg_temp.undo(3, pg_temp.got('b3 late'));
select ok((pg_temp.prof(3)).current_streak = 3 and pg_temp.counted(3),
  'undoing the late completion leaves the counted day alone');
select pg_temp.undo(3, pg_temp.got('b3 initial 2'));
select ok((pg_temp.prof(3)).current_streak = 2 and (pg_temp.prof(3)).last_streak_date = pg_temp.d() - 1
          and not pg_temp.counted(3) and pg_temp.balance_ok(3),
  'and undoing the last completion restores the day');

-- ── B4: initial first, then late, then the initial one is undone ────────────
select pg_temp.unarchive(4, 2);
select pg_temp.keep('b4 initial', pg_temp.done(4, 1));
select pg_temp.done(4, 2);
select is((pg_temp.prof(4)).current_streak, 3, '(counted by the initial completion)');
select pg_temp.undo(4, pg_temp.got('b4 initial'));
select ok((pg_temp.prof(4)).current_streak = 2 and not pg_temp.counted(4),
  'a late completion made after the day counted doesn''t keep it counted once the initial one is undone');

-- ── B5: freezes ─────────────────────────────────────────────────────────────
-- A 4-day streak ending two days ago; yesterday was scheduled and missed.
update public.profiles
   set current_streak = 4, longest_streak = 4, last_streak_date = pg_temp.d() - 2,
       streak_run_started = pg_temp.d() - 5, streak_freezes = 1
 where id = pg_temp.u(5);
select pg_temp.unarchive(5, 2);
select is((public.get_today_at(pg_temp.u(5), now()) ->> 'freezes_needed')::int, 1,
  '(one freeze is needed to keep the streak)');
select pg_temp.keep('b5', pg_temp.done(5, 2));
select ok((pg_temp.prof(5)).streak_freezes = 1 and (pg_temp.prof(5)).current_streak = 4
          and (pg_temp.prof(5)).last_streak_date = pg_temp.d() - 2 and not pg_temp.counted(5),
  'a late completion spends no freeze and leaves the streak as stored');
select ok((pg_temp.got('b5') ->> 'current_streak')::int = 4
          and (pg_temp.got('b5') ->> 'multiplier')::numeric = pg_temp.mult(4),
  'it reports and pays the streak a freeze would keep');
select ok((select (j ->> 'freezes_needed')::int = 1 and (j ->> 'current_streak')::int = 4
                  and not (j ->> 'counted_today')::boolean and (j ->> 'at_risk')::boolean
           from public.get_today_at(pg_temp.u(5), pg_temp.evening()) j),
  'get_today still needs the freeze, and the evening is still at risk');
select pg_temp.keep('b5 initial', pg_temp.done(5, 1));
select ok((pg_temp.got('b5 initial') ->> 'current_streak')::int = 5
          and (pg_temp.prof(5)).streak_freezes = 0 and pg_temp.counted(5),
  'the initial habit then spends the freeze and counts the day');

-- ── B6: milestones ──────────────────────────────────────────────────────────
update public.profiles
   set current_streak = 6, longest_streak = 6, streak_run_started = pg_temp.d() - 6
 where id = pg_temp.u(6);
select pg_temp.unarchive(6, 2);
select pg_temp.keep('b6', pg_temp.done(6, 2));
select ok((pg_temp.got('b6') -> 'milestone') = 'null'::jsonb
          and not exists (select 1 from public.streak_milestones_awarded where user_id = pg_temp.u(6))
          and not exists (select 1 from public.points_ledger
                          where user_id = pg_temp.u(6) and reason = 'streak_milestone'),
  'a late completion never awards the milestone the day would have reached');
select is((pg_temp.got('b6') ->> 'multiplier')::numeric, pg_temp.mult(6), '(it pays the 6-day multiplier, not 7)');
select pg_temp.keep('b6 initial', pg_temp.done(6, 1));
select ok((pg_temp.got('b6 initial') ->> 'milestone')::int = 7
          and (select count(*) from public.streak_milestones_awarded
               where user_id = pg_temp.u(6) and milestone = 7) = 1
          and pg_temp.balance_ok(6),
  'the initial habit then awards it once');

-- ── B7: per-habit streak of a late joiner (target 2) ────────────────────────
select pg_temp.unarchive(7, 2);
select pg_temp.keep('b7 1', pg_temp.done(7, 2));
select is((pg_temp.got('b7 1') ->> 'habit_streak')::int, 0, '(below target: no habit streak yet)');
select pg_temp.keep('b7 2', pg_temp.done(7, 2));
select ok((pg_temp.got('b7 2') ->> 'habit_streak')::int = 1
          and (select current = 1 and last_date = pg_temp.d() from public.habit_streaks
               where habit_id = pg_temp.h(7, 2)),
  'a late joiner''s own streak advances when it reaches its target');
select ok((pg_temp.prof(7)).current_streak = 2 and not pg_temp.counted(7)
          and (pg_temp.got('b7 2') ->> 'multiplier')::numeric = pg_temp.mult(2),
  'but its second completion doesn''t count the day either');
select pg_temp.undo(7, pg_temp.got('b7 2'));
select ok(not exists (select 1 from public.habit_streaks where habit_id = pg_temp.h(7, 2))
          and (pg_temp.prof(7)).current_streak = 2 and pg_temp.balance_ok(7),
  'undo drops it below target and removes the habit streak');

-- ── B8: a late joiner on a relived day ──────────────────────────────────────
-- Moved west: tomorrow was reached, today is relived and uncounted.
update public.profiles set engine_floor_date = pg_temp.d() + 1 where id = pg_temp.u(8);
select pg_temp.unarchive(8, 2);
select ok((select (j ->> 'relived')::boolean and pg_temp.late(j, pg_temp.h(8, 2))
           from public.get_today_at(pg_temp.u(8), now()) j),
  '(today is relived, and habit 2 joined late)');
select pg_temp.keep('b8', pg_temp.done(8, 2));
-- Judged as of the floor, today (scheduled, uncounted) is a miss: streak 0.
-- The late branch would have reported 2 and paid its multiplier (1.02).
select ok((pg_temp.got('b8') ->> 'multiplier')::numeric = pg_temp.mult(1)
          and (pg_temp.got('b8') ->> 'current_streak')::int = 0,
  'a late completion on a relived day is judged as relived: base multiplier, streak as of the floor');
select ok((pg_temp.prof(8)).current_streak = 2 and (pg_temp.prof(8)).last_streak_date = pg_temp.d() - 1
          and not pg_temp.counted(8),
  '(no streak change, day uncounted)');

-- ── B9: the next day, the late joiner is initial ────────────────────────────
select pg_temp.unarchive(9, 2);
select pg_temp.done(9, 1);
select is((pg_temp.prof(9)).current_streak, 3, '(today counted by habit 1)');
select ok(not pg_temp.late(public.get_today_at(pg_temp.u(9), now() + interval '1 day'), pg_temp.h(9, 2))
          and pg_temp.initial(9, 2, pg_temp.d() + 1),
  'tomorrow, the habit that joined late today is in the first snapshot');
select pg_temp.keep('b9', pg_temp.done(9, 2, now() + interval '1 day'));
select ok((pg_temp.got('b9') ->> 'current_streak')::int = 4
          and pg_temp.counted(9, pg_temp.d() + 1),
  'and its completion counts the day ("Streak from tomorrow")');

-- ── B10: late completion when today is already covered (moved east) ─────────
-- last_streak_date = today with today uncounted: the state a move east leaves.
update public.profiles
   set last_streak_date = pg_temp.d(), current_streak = 3, longest_streak = 3
 where id = pg_temp.u(0);
select pg_temp.unarchive(0, 2);
select pg_temp.keep('b10', pg_temp.done(0, 2));
select ok((pg_temp.got('b10') ->> 'current_streak')::int = 3
          and (pg_temp.got('b10') ->> 'multiplier')::numeric = pg_temp.mult(3)
          and (pg_temp.prof(0)).current_streak = 3 and (pg_temp.prof(0)).last_streak_date = pg_temp.d()
          and not pg_temp.counted(0),
  'a late completion on an inherited day reports and pays the stored streak, and changes nothing');

-- ── Ledger and parity across every user ─────────────────────────────────────
select ok((select bool_and(pg_temp.balance_ok(g)) from generate_series(0, 9) as g),
  'every balance matches its ledger');
select ok(not exists (
            select 1 from public.daily_progress d
            where d.user_id in (select pg_temp.u(g) from generate_series(0, 9) as g)
              and d.counted_for_streak
              and public.streak_as_of(d.user_id, d.streak_before, d.last_streak_date_before,
                                      d.streak_freezes_before, d.local_date) > 0
              and not exists (select 1 from public.habit_completions hc
                              join public.daily_schedule_habits sh
                                on sh.user_id = hc.user_id and sh.local_date = hc.local_date
                               and sh.habit_id = hc.habit_id
                              where hc.user_id = d.user_id and hc.local_date = d.local_date
                                and sh.initial)),
  'no day with a live streak is counted without a completion of an initial habit');
select ok(not exists (
            select 1 from public.streak_milestones_awarded m
            where m.user_id in (select pg_temp.u(g) from generate_series(0, 9) as g)
              and not exists (select 1 from public.habit_completions hc
                              join public.daily_schedule_habits sh
                                on sh.user_id = hc.user_id and sh.local_date = hc.local_date
                               and sh.habit_id = hc.habit_id
                              where hc.user_id = m.user_id and hc.local_date = m.awarded_on
                                and sh.initial)),
  -- Unqualified on purpose: a late joiner only counts a day with no live
  -- streak, where it starts a run at 1, and no milestone is configured at 1.
  'no milestone stands on a day without a completion of an initial habit');
select ok((select bool_and((h ->> 'joined_late')::boolean = not sh.initial)
           from generate_series(0, 9) as g,
                jsonb_array_elements(public.get_today_at(pg_temp.u(g), now()) -> 'habits') h
           join public.daily_schedule_habits sh
             on sh.habit_id = (h ->> 'id')::uuid and sh.local_date = pg_temp.d()),
  'get_today''s joined_late is exactly "not initial" for every listed habit');
select ok(pg_temp.initial(1, 1) and pg_temp.initial(3, 1) and not pg_temp.initial(3, 2),
  '(spot check: initial and late rows as expected)');
select lives_ok($$set constraints all immediate$$, 'deferred FKs hold');

select * from finish();
rollback;
