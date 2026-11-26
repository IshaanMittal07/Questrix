-- #116: completion points per local day never pass daily_points_cap (200).
-- Past the cap a completion still counts (streaks, milestones), earns 0
-- and writes no ledger entry; undo frees room again; milestones are uncapped.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.t(k int, m numeric default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + k * interval '1 day' + interval '12 hours' + m * interval '1 minute' $$;
create function pg_temp.done(p_uid uuid, p_habit uuid, k int, m numeric default 0)
returns jsonb language sql as $$
  select public.complete_habit_at(p_uid, p_habit, pg_temp.t(k, m)) $$;
create function pg_temp.ledger_ok(p_uid uuid) returns boolean language sql as $$
  select (select points_balance from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger where user_id = p_uid)
     and (select lifetime_points from public.profiles where id = p_uid)
       = (select coalesce(sum(delta), 0) from public.points_ledger
          where user_id = p_uid and reason in ('completion', 'streak_milestone', 'undo')) $$;

-- K1: two hard habits, target 5 each (formula 35 at streak 1; 350 a day).
-- K2: one easy habit, for the uncapped milestone.
insert into auth.users (id, email) values
  ('70000001-0000-0000-0000-000000000000', 'cap1@example.com'),
  ('70000002-0000-0000-0000-000000000000', 'cap2@example.com'),
  ('70000003-0000-0000-0000-000000000000', 'cap3@example.com');
update public.profiles set onboarded_at = now() - interval '30 days'
 where id::text like '7000000%';
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at) values
  ('7a000000-0000-0000-0000-000000000001', '70000001-0000-0000-0000-000000000000',
   'Run', 'fitness', 'hard', '{0,1,2,3,4,5,6}', 5, now() - interval '30 days'),
  ('7a000000-0000-0000-0000-000000000002', '70000001-0000-0000-0000-000000000000',
   'Lift', 'fitness', 'hard', '{0,1,2,3,4,5,6}', 5, now() - interval '30 days'),
  ('7b000000-0000-0000-0000-000000000001', '70000002-0000-0000-0000-000000000000',
   'Read', 'mind', 'easy', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  -- K3: the rate-limit loop.
  ('7c000000-0000-0000-0000-000000000001', '70000003-0000-0000-0000-000000000000',
   'A', 'mind', 'easy', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days'),
  ('7c000000-0000-0000-0000-000000000002', '70000003-0000-0000-0000-000000000000',
   'B', 'mind', 'easy', '{0,1,2,3,4,5,6}', 1, now() - interval '30 days');

-- ── Config ──────────────────────────────────────────────────────────────────
select is((public.economy_value('daily_points_cap'))::int, 200, 'the default cap is 200 a day');
select ok(not public.economy_config_value_valid('daily_points_cap', '0'), 'a cap of 0 is rejected');
select ok(not public.economy_config_value_valid('daily_points_cap', '12.5'), 'a fractional cap is rejected');
select ok(public.economy_config_value_valid('daily_points_cap', '100000'), 'up to 100,000 is allowed');

-- ── K1 day 0: five Runs pay in full (5 × 35 = 175) ──────────────────────────
select pg_temp.done('70000001-0000-0000-0000-000000000000', '7a000000-0000-0000-0000-000000000001', 0, g)
from generate_series(1, 5) as g;
create temp table k1 as
  select pg_temp.done('70000001-0000-0000-0000-000000000000', '7a000000-0000-0000-0000-000000000002', 0, 10) as j;
select is((select (j ->> 'points_awarded')::int from k1), 25, 'the next award is cut to what is left (200 − 175)');
select is((select (j ->> 'points_capped')::boolean from k1), true, 'and is reported as capped');
select is((select (j ->> 'points_today')::int || '/' || (j ->> 'daily_points_cap') from k1), '200/200',
  'the result carries the day''s total and the cap');
select is((select c.multiplier::text || ':' || c.base_points from public.habit_completions c
           where c.id = (select (j ->> 'completion_id')::uuid from k1)), '1.01:35',
  'the stored base and multiplier still show the uncapped award');

create temp table k2 as
  select pg_temp.done('70000001-0000-0000-0000-000000000000', '7a000000-0000-0000-0000-000000000002', 0, 11) as j;
select is((select (j ->> 'points_awarded')::int from k2), 0, 'past the cap a completion earns 0');
select is((select (j ->> 'occurrence')::int from k2), 2, 'but still counts as a completion');
select ok(not exists (select 1 from public.points_ledger l
                      where l.ref_id = (select (j ->> 'completion_id')::uuid from k2)),
  'and writes no ledger entry (deltas are never 0)');
select is((select points_balance || '/' || lifetime_points from public.profiles
           where id = '70000001-0000-0000-0000-000000000000'), '200/200',
  'balance and lifetime stop at the cap');
select is((select (public.get_today_at('70000001-0000-0000-0000-000000000000', pg_temp.t(0, 12)) ->> 'points_today')::int),
  200, 'get_today reports the day''s points');
select is((select (public.get_today_at('70000001-0000-0000-0000-000000000000', pg_temp.t(0, 12)) ->> 'daily_points_cap')::int),
  200, 'and the cap');

-- ── Undo ────────────────────────────────────────────────────────────────────
select lives_ok($$select public.undo_completion_at('70000001-0000-0000-0000-000000000000',
                    (select (j ->> 'completion_id')::uuid from k2), pg_temp.t(0, 13))$$,
  'a 0-point completion can be undone');
select is((select points_balance from public.profiles where id = '70000001-0000-0000-0000-000000000000'), 200,
  'which changes no points');
select ok(not exists (select 1 from public.points_ledger where reason = 'undo'
                      and user_id = '70000001-0000-0000-0000-000000000000'),
  'and writes no undo entry');
select lives_ok($$select public.undo_completion_at('70000001-0000-0000-0000-000000000000',
                    (select (j ->> 'completion_id')::uuid from k1), pg_temp.t(0, 14))$$,
  'undoing the cut award works');
select is((select (pg_temp.done('70000001-0000-0000-0000-000000000000',
                                '7a000000-0000-0000-0000-000000000002', 0, 15) ->> 'points_awarded')::int),
  25, 'and frees its room again, never more than the cap');
select ok(pg_temp.ledger_ok('70000001-0000-0000-0000-000000000000'), 'balance and lifetime still match the ledger');

-- ── The next day starts from 0 ──────────────────────────────────────────────
select is((select (pg_temp.done('70000001-0000-0000-0000-000000000000',
                                '7a000000-0000-0000-0000-000000000001', 1) ->> 'points_awarded')::int),
  35, 'a new local day pays in full again (35 at a 2-day streak is floor(35 × 1.02))');
select is((select sum(points_awarded)::int from public.habit_completions
           where user_id = '70000001-0000-0000-0000-000000000000'
             and local_date = (pg_temp.t(0) at time zone 'UTC')::date), 200,
  'and day 0 stays at the cap');

-- ── Milestones aren't capped ───────────────────────────────────────────────
update public.economy_config set value = '5' where key = 'daily_points_cap';
select pg_temp.done('70000002-0000-0000-0000-000000000000', '7b000000-0000-0000-0000-000000000001', k)
from generate_series(0, 1) as k;
create temp table m3 as
  select pg_temp.done('70000002-0000-0000-0000-000000000000', '7b000000-0000-0000-0000-000000000001', 2) as j;
select is((select (j ->> 'points_awarded') || '+' || (j ->> 'milestone_points') from m3), '5+25',
  'a capped day still pays the 3-day milestone in full');
select ok(pg_temp.ledger_ok('70000002-0000-0000-0000-000000000000'), 'and the ledger matches (15 + 25)');

-- ── A relived day shares its date's cap (a move west) ──────────────────────
-- K1 reached day 1, so day 0 is relived now (the time seam runs backwards).
create temp table rv as
  select pg_temp.done('70000001-0000-0000-0000-000000000000', '7a000000-0000-0000-0000-000000000002', 0, 30) as j;
select is((select (j ->> 'points_awarded')::int || ':' || (j ->> 'points_capped') from rv), '0:true',
  'a relived day already at its cap pays 0');
select is((select sum(points_awarded)::int from public.habit_completions
           where user_id = '70000001-0000-0000-0000-000000000000'
             and local_date = (pg_temp.t(0) at time zone 'UTC')::date), 200,
  'and the date stays at the cap whichever timezone earned it');

-- ── A late joiner past the cap ──────────────────────────────────────────────
-- Added now, so it joins today's (day 0's) snapshot late; K2 is already at
-- its cap of 5 there.
insert into public.habits (id, user_id, title, category, difficulty, days_of_week, target_per_day, created_at) values
  ('7b000000-0000-0000-0000-000000000002', '70000002-0000-0000-0000-000000000000',
   'Late', 'mind', 'hard', '{0,1,2,3,4,5,6}', 1, now());
select is((select (pg_temp.done('70000002-0000-0000-0000-000000000000',
                                '7b000000-0000-0000-0000-000000000002', 0, 30) ->> 'points_awarded')::int),
  0, 'a habit that joined the day late is capped like any other');

-- ── The engine rate limit counts calls, not ledger rows ────────────────────
select ok(not has_table_privilege('authenticated', 'public.engine_rate', 'select'), 'users can''t read the rate counter');
select ok(not has_function_privilege('authenticated', 'public.engine_rate_limit(uuid)', 'execute'),
  'or call the limiter directly');
-- K3 caps out on A (cap 5), then loops B: each call earns 0 and writes no
-- ledger row, so only the per-call counter can stop it.
select pg_temp.done('70000003-0000-0000-0000-000000000000', '7c000000-0000-0000-0000-000000000001', 0, 1);
select set_config('request.jwt.claims', '{"sub":"70000003-0000-0000-0000-000000000000","role":"authenticated"}', true);
select lives_ok($$
  do $do$
  declare v jsonb;
  begin
    for i in 1..15 loop
      v := public.complete_habit_at('70000003-0000-0000-0000-000000000000',
                                    '7c000000-0000-0000-0000-000000000002', pg_temp.t(0, 2 + i));
      perform public.undo_completion_at('70000003-0000-0000-0000-000000000000',
                                        (v ->> 'completion_id')::uuid, pg_temp.t(0, 2.5 + i));
    end loop;
  end $do$ $$, '30 capped-out calls in a minute are allowed');
select throws_ok($$select public.complete_habit_at('70000003-0000-0000-0000-000000000000',
                    '7c000000-0000-0000-0000-000000000002', pg_temp.t(0, 20))$$,
  'QX109', null, 'the 31st is refused, though it writes no ledger row');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
