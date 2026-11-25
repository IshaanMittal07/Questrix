-- Phase 4 (#81): a move west must not let a user complete a day they already
-- missed. A relived day (before profiles.engine_floor_date, the old today at
-- the last westward timezone change, and after the last counted day) earns
-- points but never changes the streak or freezes.
--
-- The time seam simulates the move: pg_temp.west sets the floor as
-- profiles_validate would, then "now" runs back. R5 makes a real change.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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
-- Noon UTC k days from today, plus m minutes.
create function pg_temp.t(k int, m numeric default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + k * interval '1 day' + interval '12 hours' + m * interval '1 minute' $$;
create function pg_temp.day(k int) returns date language sql as $$
  select (pg_temp.t(k) at time zone 'UTC')::date $$;
create function pg_temp.u(n int) returns uuid language sql as $$
  select ('4000000' || n || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.h(n int) returns uuid language sql as $$
  select ('b000000' || n || '-0000-0000-0000-000000000000')::uuid $$;
create function pg_temp.done(n int, k int, m numeric default 0) returns jsonb language sql as $$
  select public.complete_habit_at(pg_temp.u(n), pg_temp.h(n), pg_temp.t(k, m)) $$;
create function pg_temp.today(n int, k int, m numeric default 0) returns jsonb language sql as $$
  select public.get_today_at(pg_temp.u(n), pg_temp.t(k, m)) $$;
create function pg_temp.west(n int, k int) returns void language sql as $$
  update public.profiles set engine_floor_date = pg_temp.day(k) where id = pg_temp.u(n) $$;
create function pg_temp.prof(n int) returns public.profiles language sql as $$
  select * from public.profiles where id = pg_temp.u(n) $$;
create function pg_temp.counted(n int, d date) returns boolean language sql as $$
  select coalesce((select counted_for_streak from public.daily_progress
                   where user_id = pg_temp.u(n) and local_date = d), false) $$;
create function pg_temp.balance_ok(n int) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = pg_temp.u(n))
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = pg_temp.u(n)) $$;

-- R1 the exploit, no freezes · R2 with a freeze · R3 first completion ever ·
-- R4 undo on a relived day · R5 a real UTC+14 → UTC-12 change ·
-- R6 target 2: a relived day, then the reached day and its undo ·
-- R7 target 2: a relived day half done.
insert into auth.users (id, email)
select pg_temp.u(g), 'r' || g || '@example.com' from generate_series(1, 8) as g;
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at)
select pg_temp.h(g), pg_temp.u(g), 'Daily', 'mind', 'medium', '{0,1,2,3,4,5,6}', case when g in (1, 6, 7) then 2 else 1 end, now() - interval '30 days'
from generate_series(1, 8) as g;
update public.profiles set timezone = 'Pacific/Kiritimati' where id = pg_temp.u(5);
update public.profiles set onboarded_at = now() - interval '30 days'
  where id in (select pg_temp.u(g) from generate_series(1, 8) as g);

-- ── R1: missed day 3, reached day 4, then back on day 3 ─────────────────────
select pg_temp.done(1, 1);
select pg_temp.done(1, 2);
select pg_temp.today(1, 4);
select pg_temp.west(1, 4);
create temp table r1 as select 1 as occ, pg_temp.done(1, 3) as j;
select ok(((select j from r1) ->> 'points_awarded')::int > 0,
  'a completion on a relived day still earns points');
select ok((pg_temp.prof(1)).current_streak = 2 and (pg_temp.prof(1)).last_streak_date = pg_temp.day(2),
  'but the streak and last_streak_date don''t move');
select ok(not pg_temp.counted(1, pg_temp.day(3)), 'and the relived day stays uncounted');
insert into r1 select 2, pg_temp.done(1, 3, 1);
select ok((pg_temp.prof(1)).current_streak = 2 and not pg_temp.counted(1, pg_temp.day(3)),
  'a second completion that day doesn''t count it either');
select ok((select bool_and((j ->> 'current_streak')::int = 0) from r1),
  'the completion reports the streak as judged on the reached day (lost), as get_today does');
-- Counted, day 3 would have taken the streak to 3: a milestone.
select ok((select bool_and(j -> 'milestone' = 'null'::jsonb and j -> 'milestone_points' = 'null'::jsonb) from r1)
          and not exists (select 1 from public.streak_milestones_awarded where user_id = pg_temp.u(1))
          and not exists (select 1 from public.points_ledger
                          where user_id = pg_temp.u(1) and reason = 'streak_milestone'),
  'a relived day never awards the milestone it would have reached');
select ok((select bool_and((j ->> 'multiplier')::numeric = round(1 + (public.economy_value('multiplier_step'))::numeric, 2)) from r1),
  'a relived day pays the base multiplier, not the stored streak''s (it may already be lost)');
select ok(not pg_temp.counted(1, pg_temp.day(3)), '(still uncounted)');
create temp table gt as select pg_temp.today(1, 3, 480) as j;  -- 20:00 on day 3
select ok((select (j ->> 'relived')::boolean from gt), 'get_today reports the day as relived');
select ok((select not (j ->> 'at_risk')::boolean from gt), 'a relived day is never at risk, even at 20:00');
select is((select (j ->> 'freezes_needed')::int from gt), 0, 'and needs no freezes');
select is((select (j ->> 'current_streak')::int from gt), 0,
  'its streak is judged as of the reached day (day 3 is missed, no freezes)');
select is((pg_temp.done(1, 4) ->> 'current_streak')::int, 1,
  'back on the reached day, the missed day still breaks the streak');
select ok(not (pg_temp.today(1, 4) ->> 'relived')::boolean, 'and the reached day is not relived');
select ok(not (pg_temp.today(1, 3) ->> 'relived')::boolean,
  'once the reached day counts, the missed day is no longer relived (rule 0 covers it)');
select ok(not exists (select 1 from public.streak_milestones_awarded where user_id = pg_temp.u(1)),
  '(still no milestone: the streak restarted at 1)');
select ok(pg_temp.balance_ok(1), 'the balance matches the ledger');

-- ── R2: the same with one freeze ────────────────────────────────────────────
update public.profiles set streak_freezes = 1 where id = pg_temp.u(2);
select pg_temp.done(2, 1);
select pg_temp.done(2, 2);
select pg_temp.today(2, 4);
select pg_temp.west(2, 4);
create temp table gt2 as select pg_temp.today(2, 3, 480) as j;  -- 20:00 on day 3
select ok((select (j ->> 'relived')::boolean and (j ->> 'current_streak')::int = 2
                  and (j ->> 'freezes_needed')::int = 0 and not (j ->> 'at_risk')::boolean from gt2),
  'a relived day judges the streak as of the reached day (the freeze keeps it) and needs no freeze itself');
select pg_temp.done(2, 3);
select ok((pg_temp.prof(2)).streak_freezes = 1 and (pg_temp.prof(2)).current_streak = 2,
  'a relived day doesn''t spend or save a freeze');
create temp table gt2r as select pg_temp.today(2, 4, 420) as j;  -- 19:00 on day 4
select ok((select not (j ->> 'relived')::boolean and (j ->> 'freezes_needed')::int = 1
                  and (j ->> 'current_streak')::int = 2 and (j ->> 'at_risk')::boolean from gt2r),
  'after relived completions the reached day still needs the freeze and is at risk at 19:00');
create temp table r2 as select pg_temp.done(2, 4) as j;
select is(((select j from r2) ->> 'current_streak')::int, 3,
  'the reached day spends the freeze on the missed day');
select ok(((select j from r2) ->> 'milestone')::int = 3
          and exists (select 1 from public.streak_milestones_awarded
                      where user_id = pg_temp.u(2) and milestone = 3
                        and awarded_on = pg_temp.day(4) and streak_run_started = pg_temp.day(1)),
  'the 3-day milestone comes on the reached day, in the original run');
select is((pg_temp.prof(2)).streak_freezes, 0, '(the freeze is gone: no free freeze from moving west)');

-- ── R3: a first completion ever on a relived day ────────────────────────────
select pg_temp.today(3, 2);
select pg_temp.west(3, 2);
select is((pg_temp.done(3, 1) ->> 'current_streak')::int, 0,
  'a first completion on a relived day doesn''t start a streak');
select ok((pg_temp.prof(3)).last_streak_date is null and (pg_temp.prof(3)).streak_run_started is null,
  'nor set the run');
select ok((pg_temp.today(3, 1) ->> 'relived')::boolean, 'get_today reports it as relived');
select is((pg_temp.done(3, 2) ->> 'current_streak')::int, 1,
  'the reached day then starts the streak at 1');

-- ── R4: undo on a relived day ───────────────────────────────────────────────
select pg_temp.done(4, 1);
select pg_temp.today(4, 3);
select pg_temp.west(4, 3);
create temp table r4 as
  select (pg_temp.prof(4)).points_balance as bal, (pg_temp.prof(4)).current_streak as st,
         pg_temp.done(4, 2) as j;
select lives_ok($$select public.undo_completion_at(pg_temp.u(4), ((select j from r4) ->> 'completion_id')::uuid, pg_temp.t(2, 1))$$,
  'a relived completion can be undone');
select ok((pg_temp.prof(4)).points_balance = (select bal from r4)
          and (pg_temp.prof(4)).current_streak = (select st from r4)
          and (pg_temp.prof(4)).last_streak_date = pg_temp.day(1),
  'undo gives back the points and leaves the streak alone');
select ok(pg_temp.balance_ok(4) and not pg_temp.counted(4, pg_temp.day(2)), 'the ledger matches and the day stays uncounted');

-- ── R5: a real timezone change, UTC+14 → UTC-12 (the audit's exploit) ───────
-- Two days counted ending 3 days ago (Kiritimati), two days missed since.
-- The change snapshots today in Kiritimati; the new local date is 1 or 2
-- days earlier, after the last counted day either way.
select public.complete_habit_at(pg_temp.u(5), pg_temp.h(5), now() - interval '4 days');
select public.complete_habit_at(pg_temp.u(5), pg_temp.h(5), now() - interval '3 days');
create temp table r5 as select public.local_date_in('Pacific/Kiritimati', now()) as d_east;
select pg_temp.as_user(pg_temp.u(5));
update public.profiles set timezone = 'Etc/GMT+12' where id = pg_temp.u(5);
select pg_temp.as_postgres();
select ok(exists (select 1 from public.daily_schedule
                  where user_id = pg_temp.u(5) and local_date = (select d_east from r5)),
  '(the change snapshotted the old today)');
select is((pg_temp.prof(5)).engine_floor_date, (select d_east from r5),
  'moving west records the old today as the floor');
select public.complete_habit_at(pg_temp.u(5), pg_temp.h(5), now());
select is((pg_temp.prof(5)).current_streak, 2,
  'after moving west, completing a missed day leaves the streak alone');
select ok(not pg_temp.counted(5, public.local_date_in('Etc/GMT+12', now())), 'and doesn''t count the day');
select is((public.complete_habit_at(pg_temp.u(5), pg_temp.h(5),
            ((select d_east from r5) + time '12:00')::timestamp at time zone 'Etc/GMT+12') ->> 'current_streak')::int, 1,
  'when the old today comes round again, the missed days break the streak');

-- ── R6: target 2, a relived day done in full, then the reached day ─────────
-- Days 1 and 2 done 2 of 2, day 4 reached, then day 3 relived.
select pg_temp.done(6, 1); select pg_temp.done(6, 1, 1);
select pg_temp.done(6, 2); select pg_temp.done(6, 2, 1);
select pg_temp.today(6, 4);
select pg_temp.west(6, 4);
create temp table gt6 as select pg_temp.today(6, 3, 480) as j;  -- 20:00 on day 3
select ok((select (j ->> 'relived')::boolean and not (j ->> 'at_risk')::boolean
                  and (j -> 'habits' -> 0 ->> 'habit_streak')::int = 2 from gt6),
  'R6: relived at 20:00, not at risk, the habit streak still shown');
select pg_temp.done(6, 3);
create temp table r6a as select pg_temp.done(6, 3, 1) as j;
select ok(((select j from r6a) ->> 'habit_streak')::int = 2
          and (select current = 2 and last_date = pg_temp.day(2) from public.habit_streaks where habit_id = pg_temp.h(6))
          and (pg_temp.prof(6)).current_streak = 2 and (pg_temp.prof(6)).last_streak_date = pg_temp.day(2)
          and not pg_temp.counted(6, pg_temp.day(3)),
  'R6: reaching the target on a relived day advances neither streak (#85)');
select ok(((select j from r6a) ->> 'points_awarded')::int > 0 and pg_temp.balance_ok(6),
  'R6: the relived points are in the ledger');
select is((pg_temp.today(6, 4) -> 'habits' -> 0 ->> 'habit_streak')::int, 0,
  'R6: the reached day sees the habit streak broken: the relived day doesn''t bridge it (#85)');
create temp table r6 as select 1 as occ, pg_temp.done(6, 4) as j;
insert into r6 select 2, pg_temp.done(6, 4, 1);
select ok(((select j from r6 where occ = 2) ->> 'current_streak')::int = 1
          and ((select j from r6 where occ = 2) ->> 'habit_streak')::int = 1,
  'R6: on the reached day the missed day breaks both streaks (#85)');
select ok((select bool_and(habit_current_before = 2 and habit_last_date_before = pg_temp.day(2))
           from public.habit_completions where habit_id = pg_temp.h(6) and local_date = pg_temp.day(4)),
  'R6: both reached-day completions saved the habit state from before the relived day');
select lives_ok($$
  select public.undo_completion_at(pg_temp.u(6), ((select j from r6 where occ = 2) ->> 'completion_id')::uuid, pg_temp.t(4, 2));
  select public.undo_completion_at(pg_temp.u(6), ((select j from r6 where occ = 1) ->> 'completion_id')::uuid, pg_temp.t(4, 2))$$,
  'R6: both reached-day completions can be undone');
select ok((pg_temp.prof(6)).current_streak = 2 and (pg_temp.prof(6)).last_streak_date = pg_temp.day(2)
          and (pg_temp.prof(6)).streak_run_started = pg_temp.day(1)
          and not pg_temp.counted(6, pg_temp.day(4)) and not pg_temp.counted(6, pg_temp.day(3)),
  'R6: undo restores the pre-reached-day streak; neither day is counted');
select ok((select current = 2 and longest = 2 and last_date = pg_temp.day(2)
           from public.habit_streaks where habit_id = pg_temp.h(6)) and pg_temp.balance_ok(6),
  'R6: the habit streak goes back to day 2; the ledger matches');
select lives_ok($$select public.undo_completion_at(pg_temp.u(6), ((select j from r6a) ->> 'completion_id')::uuid, pg_temp.t(3, 2))$$,
  'R6: a relived-day completion can still be undone (no false QX108, #85)');
select ok((select current = 2 and last_date = pg_temp.day(2) from public.habit_streaks where habit_id = pg_temp.h(6))
          and pg_temp.balance_ok(6),
  'R6: and that undo leaves the habit streak alone');
select ok((pg_temp.today(6, 3) ->> 'relived')::boolean,
  'R6: with the reached day undone, the missed day is relived again');
create temp table gt6r as select pg_temp.today(6, 4) as j;
select ok((select not (j ->> 'relived')::boolean and (j ->> 'current_streak')::int = 0
                  and (j ->> 'freezes_needed')::int = 0 from gt6r),
  'R6: and the reached day still sees the streak as broken');
select is((pg_temp.done(6, 4, 3) ->> 'current_streak')::int, 1,
  'R6: redoing the reached day can''t launder the missed day');

-- ── R7: target 2, a relived day half done ───────────────────────────────────
select pg_temp.done(7, 1); select pg_temp.done(7, 1, 1);
select pg_temp.done(7, 2); select pg_temp.done(7, 2, 1);
select pg_temp.today(7, 4);
select pg_temp.west(7, 4);
select is((pg_temp.done(7, 3) ->> 'habit_streak')::int, 2,
  'R7: one of two on a relived day leaves the habit streak alone');
select pg_temp.done(7, 4);
create temp table r7 as select pg_temp.done(7, 4, 1) as j;
select ok(((select j from r7) ->> 'habit_streak')::int = 1
          and ((select j from r7) ->> 'current_streak')::int = 1,
  'R7: the half-done relived day breaks both streaks on the reached day');
select ok(pg_temp.balance_ok(7), 'R7: the ledger matches');

-- ── R8: no move, a completion just before midnight (review of PR #84, B1) ──
-- get_today at 00:00:01 of day 3 snapshots day 3 first (the rollover
-- refetch), then a completion from 23:59:30 of day 2 lands. With no move
-- west, day 2 counts as usual.
select pg_temp.done(8, 0);
select pg_temp.done(8, 1);
select pg_temp.today(8, 2, 720.02);
create temp table r8 as select pg_temp.done(8, 2, 719.5) as j;
select ok(((select j from r8) ->> 'current_streak')::int = 3 and pg_temp.counted(8, pg_temp.day(2))
          and ((select j from r8) ->> 'milestone')::int = 3,
  'R8: a later snapshot alone never makes a day relived (only a move west does)');

-- ── The floor is server-only ────────────────────────────────────────────────
select column_privs_are('public', 'profiles', 'engine_floor_date', 'authenticated', array['SELECT'],
  'clients can read but not write engine_floor_date');
select pg_temp.as_user(pg_temp.u(8));
select throws_ok($$update public.profiles set engine_floor_date = null where id = pg_temp.u(8)$$,
  '42501', null, 'a client can''t clear the floor');
select pg_temp.as_postgres();

select * from finish();
rollback;
