-- Phase 4 (#70): engine invariants under a randomized (seeded) sequence of
-- complete / undo / spend / time steps, checked after every step (plan §10).
--
-- The seed fixes every choice; the calendar dates move with now(), so the
-- weekday-scheduled habit lands on different days from run to run. That's
-- deliberate: the invariants must hold for any schedule.
--
-- Spending uses a postgres-only admin_adjust entry until purchase_item
-- exists (DECISIONS: "Spending before Phase 6"); Phase 6 re-runs this with it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Users 4000000{1..4}; users 2 and 4 start with two freezes.
insert into auth.users (id, email)
select ('4000000' || g || '-0000-0000-0000-000000000000')::uuid, 'inv' || g || '@example.com'
from generate_series(1, 4) as g;
insert into public.habits (id, user_id, title, category, difficulty, target_per_day, days_of_week, created_at)
select ('f' || g || '00000' || k || '-0000-0000-0000-000000000000')::uuid,
       ('4000000' || g || '-0000-0000-0000-000000000000')::uuid,
       'H' || k, 'mind',
       (array['medium', 'easy', 'hard', 'easy'])[k]::public.habit_difficulty,
       (array[1, 2, 1, 3])[k],
       case when k = 3 then '{1,3,5,6}'::smallint[] else '{0,1,2,3,4,5,6}'::smallint[] end,
       now() - interval '40 days'
from generate_series(1, 4) as g, generate_series(1, 4) as k;
update public.profiles set onboarded_at = now() - interval '40 days' where id::text like '4000000%';
update public.profiles set streak_freezes = 2
 where id in ('40000002-0000-0000-0000-000000000000', '40000004-0000-0000-0000-000000000000');

create function pg_temp.mine(p_uid uuid) returns boolean language sql as $$
  select left(p_uid::text, 7) = '4000000' $$;

/** The names of every invariant that fails right now (empty = all hold). */
create function pg_temp.violations() returns text[] language sql as $$
  select coalesce(array_agg(name order by name), '{}') from (
    select 'balance = ledger' as name where exists (
      select 1 from public.profiles p where pg_temp.mine(p.id)
        and p.points_balance <> (select coalesce(sum(delta), 0) from public.points_ledger l where l.user_id = p.id))
    union all
    select 'lifetime = completion + milestone + undo' where exists (
      select 1 from public.profiles p where pg_temp.mine(p.id)
        and p.lifetime_points <> (select coalesce(sum(delta), 0) from public.points_ledger l
                                  where l.user_id = p.id and l.reason in ('completion', 'streak_milestone', 'undo')))
    union all
    select 'streak state is sane' where exists (
      select 1 from public.profiles p where pg_temp.mine(p.id)
        and (p.current_streak < 0 or p.current_streak > p.longest_streak
             or (p.current_streak > 0) <> (p.last_streak_date is not null)
             or p.streak_freezes not between 0 and 2))
    union all
    select 'completed_count matches completions' where exists (
      select 1 from public.daily_progress d where pg_temp.mine(d.user_id)
        and d.completed_count <> (select count(*) from public.habit_completions c
                                  where c.user_id = d.user_id and c.local_date = d.local_date))
    union all
    select 'no empty day is counted' where exists (
      select 1 from public.daily_progress d where pg_temp.mine(d.user_id)
        and d.counted_for_streak and d.completed_count = 0)
    union all
    select 'every award follows the formula' where exists (
      select 1 from public.habit_completions c where pg_temp.mine(c.user_id)
        and c.points_awarded <> floor(c.base_points * c.multiplier))
    union all
    select 'occurrences stay within the snapshotted target' where exists (
      select 1 from public.habit_completions c
      join public.daily_schedule_habits sh
        on sh.user_id = c.user_id and sh.local_date = c.local_date and sh.habit_id = c.habit_id
      where pg_temp.mine(c.user_id) and c.occurrence not between 1 and sh.target_per_day)
    union all
    select 'every streak ends on a day with a completion' where exists (
      select 1 from public.profiles p where pg_temp.mine(p.id) and p.last_streak_date is not null
        and not exists (select 1 from public.habit_completions c
                        where c.user_id = p.id and c.local_date = p.last_streak_date))
    union all
    select 'every habit streak ends on a day that reached its target' where exists (
      select 1 from public.habit_streaks hs
      left join public.daily_schedule_habits sh
        on sh.user_id = hs.user_id and sh.habit_id = hs.habit_id and sh.local_date = hs.last_date
      where pg_temp.mine(hs.user_id)
        and (sh.habit_id is null
             or (select count(*) from public.habit_completions c
                 where c.habit_id = hs.habit_id and c.local_date = hs.last_date) < sh.target_per_day))
    union all
    select 'every completion has its ledger entry' where exists (
      select 1 from public.habit_completions c where pg_temp.mine(c.user_id)
        and not exists (select 1 from public.points_ledger l
                        where l.reason = 'completion' and l.ref_id = c.id and l.delta = c.points_awarded))
    union all
    select 'every removed award was reversed exactly once' where exists (
      select 1 from public.points_ledger l
      where pg_temp.mine(l.user_id) and l.reason in ('completion', 'streak_milestone')
        and not exists (select 1 from public.habit_completions c where c.id = l.ref_id)
        and not exists (select 1 from public.streak_milestones_awarded m where m.id = l.ref_id)
        and (select count(*) from public.points_ledger u
             where u.reason = 'undo' and u.ref_id = l.ref_id and u.delta = -l.delta) <> 1)
    union all
    select 'every milestone has its ledger entry and a completed day' where exists (
      select 1 from public.streak_milestones_awarded m where pg_temp.mine(m.user_id)
        and (not exists (select 1 from public.points_ledger l
                         where l.reason = 'streak_milestone' and l.ref_id = m.id and l.delta = m.points)
             or not exists (select 1 from public.habit_completions c
                            where c.user_id = m.user_id and c.local_date = m.awarded_on)))
  ) v;
$$;

create temp table stats (k text primary key, n int not null default 0);
create temp table failures (step int, what text[]);
create function pg_temp.bump(p_k text) returns void language sql as $$
  insert into stats values (p_k, 1) on conflict (k) do update set n = stats.n + 1 $$;
create function pg_temp.stat(p_k text) returns int language sql as $$
  select coalesce((select n from stats where k = p_k), 0) $$;

create temp table mismatches (step int, what text);

/**
 * Where get_today (taken just before) disagrees with the completion that
 * followed, or null. The completion adds a day to the global streak unless
 * the day is already covered (last_streak_date >= today), and to the habit
 * streak when it reaches the target on a day after the habit's last_date.
 */
create function pg_temp.disagreement(p_gt jsonb, p_listed jsonb, p_c jsonb, p_last date,
                                     p_hlast date, p_fb int, p_fa int) returns text language sql as $$
  select case
    when p_listed is null then 'completed but not listed'
    when (p_gt ->> 'local_date') <> (p_c ->> 'local_date') then 'local_date'
    when (p_listed ->> 'target')::int <> (p_c ->> 'target')::int then 'target'
    when (p_c ->> 'current_streak')::int - (p_gt ->> 'current_streak')::int
         <> case when p_last >= (p_c ->> 'local_date')::date then 0 else 1 end then 'current_streak'
    when (p_gt ->> 'freezes_needed')::int <> p_fb - p_fa or (p_gt ->> 'streak_freezes')::int <> p_fb
      then 'freezes_needed'
    when (p_c ->> 'occurrence') = (p_c ->> 'target')
         and (p_c ->> 'habit_streak')::int - (p_listed ->> 'habit_streak')::int
             <> case when p_hlast >= (p_c ->> 'local_date')::date then 0 else 1 end then 'habit_streak'
  end $$;

create function pg_temp.simulate(p_steps int) returns void language plpgsql as $$
declare
  v_now timestamptz := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
                       - interval '30 days' + interval '8 hours';
  v_uid uuid;
  v_habit uuid;
  v_completion uuid;
  v_balance int;
  v_amount int;
  r float8;
  v text[];
  v_gt jsonb;
  v_c jsonb;
  v_listed jsonb;
  v_last date;
  v_hlast date;
  v_fb int;
  v_bad text;
begin
  for step in 1 .. p_steps loop
    v_uid := ('4000000' || (1 + floor(random() * 4))::int || '-0000-0000-0000-000000000000')::uuid;
    r := random();
    if r < 0.55 then
      v_habit := ('f' || substr(v_uid::text, 8, 1) || '00000' || (1 + floor(random() * 4))::int
                  || '-0000-0000-0000-000000000000')::uuid;
      -- get_today first, in the same subtransaction (a refusal rolls back its
      -- snapshot too, so the walk is unchanged); it must predict the result.
      v_gt := null;
      v_listed := null;
      v_bad := null;
      begin
        v_gt := public.get_today_at(v_uid, v_now);
        select last_streak_date, streak_freezes into v_last, v_fb from public.profiles where id = v_uid;
        v_hlast := (select hs.last_date from public.habit_streaks hs where hs.habit_id = v_habit);
        v_listed := (select h from jsonb_array_elements(v_gt -> 'habits') h where (h ->> 'id')::uuid = v_habit);
        v_c := public.complete_habit_at(v_uid, v_habit, v_now);
        v_completion := (v_c ->> 'completion_id')::uuid;
        perform pg_temp.bump('complete');
        v_bad := pg_temp.disagreement(v_gt, v_listed, v_c, v_last, v_hlast, v_fb,
                                      (select streak_freezes from public.profiles where id = v_uid));
      exception when others then
        v_completion := null;
        perform pg_temp.bump('complete refused ' || sqlstate);
        if sqlstate = 'QX101' and v_listed is not null then
          v_bad := 'refused as unscheduled but listed';
        elsif sqlstate = 'QX103' and (v_listed is null
                                      or (v_listed ->> 'done')::int < (v_listed ->> 'target')::int) then
          v_bad := 'refused as done but listed with room';
        end if;
      end;
      if v_gt is not null then
        perform pg_temp.bump('get_today checked');
      end if;
      if v_bad is not null then
        insert into mismatches values (step, v_bad);
      end if;
      -- Often undone a few minutes later (sometimes past the window).
      if v_completion is not null and random() < 0.3 then
        v_now := v_now + floor(random() * 18) * interval '1 minute';
        begin
          perform public.undo_completion_at(v_uid, v_completion, v_now);
          perform pg_temp.bump('undo');
        exception when others then
          perform pg_temp.bump('undo refused ' || sqlstate);
        end;
      end if;
    elsif r < 0.75 then
      select c.id into v_completion from public.habit_completions c
      where c.user_id = v_uid and c.completed_at >= v_now - interval '20 minutes'
      order by random() limit 1;
      if found then
        begin
          perform public.undo_completion_at(v_uid, v_completion, v_now);
          perform pg_temp.bump('undo');
        exception when others then
          perform pg_temp.bump('undo refused ' || sqlstate);
        end;
      end if;
    elsif r < 0.83 then
      select points_balance into v_balance from public.profiles where id = v_uid;
      v_amount := floor(random() * v_balance * 0.6)::int;
      if v_amount > 0 then
        insert into public.points_ledger (user_id, delta, reason) values (v_uid, -v_amount, 'admin_adjust');
        update public.profiles set points_balance = points_balance - v_amount where id = v_uid;
        perform pg_temp.bump('spend');
      end if;
    elsif r < 0.88 then
      -- A relived stretch, as after a move west.
      v_now := v_now - (30 + floor(random() * 90)) * interval '1 minute';
      perform pg_temp.bump('back');
    elsif r < 0.92 then
      -- Skip a day or three: misses, freezes and broken streaks.
      v_now := v_now + (1 + floor(random() * 3)) * interval '1 day';
      perform pg_temp.bump('jump');
    end if;
    v_now := v_now + floor(random() * 150) * interval '1 minute';

    v := pg_temp.violations();
    if cardinality(v) > 0 and not exists (select 1 from failures) then
      insert into failures values (step, v);
    end if;
  end loop;
end $$;

select setseed(0.4242);
select lives_ok($$select pg_temp.simulate(800)$$, 'an 800-step random sequence runs');

select is((select coalesce(array_agg(step || ': ' || array_to_string(what, ', ')), '{}') from failures), '{}'::text[],
  'every invariant held after every step');
select is(pg_temp.violations(), '{}'::text[], 'and at the end');
select is((select coalesce(array_agg(step || ': ' || what order by step), '{}') from mismatches), '{}'::text[],
  'get_today predicted every completion (streak, freezes, habit streak, listing) and every refusal');
select cmp_ok(pg_temp.stat('get_today checked'), '>=', 300, 'get_today was checked before at least 300 completion attempts');
select is((select coalesce(array_agg(k order by k), '{}') from stats
           where k like '% refused %'
             and split_part(k, ' refused ', 2) not in ('QX101', 'QX103', 'QX104', 'QX105', 'QX106', 'QX108')),
  '{}'::text[], 'every refusal was an expected engine code');

-- The sequence actually exercised the engine.
select cmp_ok(pg_temp.stat('complete'), '>=', 200, 'at least 200 completions');
select cmp_ok(pg_temp.stat('undo'), '>=', 30, 'at least 30 undos');
select cmp_ok(pg_temp.stat('spend'), '>=', 20, 'at least 20 spends');
select cmp_ok(pg_temp.stat('back') + pg_temp.stat('jump'), '>=', 50, 'at least 50 relived stretches or skipped days');
select cmp_ok((select count(*)::int from public.points_ledger
               where reason = 'streak_milestone' and pg_temp.mine(user_id)), '>=', 1, 'milestones were awarded');
select cmp_ok((select count(*)::int from public.daily_progress
               where pg_temp.mine(user_id) and streak_freezes_used > 0), '>=', 1, 'freezes were spent');
select cmp_ok((select count(*)::int from public.points_ledger
               where reason = 'undo' and pg_temp.mine(user_id)), '>=', 30, 'undos reversed awards');

-- The checker itself catches a broken invariant.
update public.profiles set points_balance = points_balance + 1, current_streak = longest_streak + 1
 where id = '40000001-0000-0000-0000-000000000000';
select ok(pg_temp.violations() @> array['balance = ledger', 'streak state is sane'],
  'the checker flags a corrupted balance and streak');
update public.profiles set points_balance = points_balance - 1 where id = '40000001-0000-0000-0000-000000000000';
update public.profiles set current_streak = 0, last_streak_date = null, streak_run_started = null
 where id = '40000001-0000-0000-0000-000000000000';
select ok(not (pg_temp.violations() && array['balance = ledger', 'streak state is sane']),
  '(and clears once it''s repaired)');

-- The parity checker flags a get_today that overstates (or fails to add) a day.
select ok(pg_temp.disagreement(
            '{"local_date": "2026-01-02", "current_streak": 3, "freezes_needed": 0, "streak_freezes": 0}',
            '{"target": 1, "habit_streak": 0}',
            '{"local_date": "2026-01-02", "target": 1, "occurrence": 1, "current_streak": 3, "habit_streak": 1}',
            '2026-01-01', null, 0, 0) = 'current_streak'
          and pg_temp.disagreement(
            '{"local_date": "2026-01-02", "current_streak": 2, "freezes_needed": 0, "streak_freezes": 0}',
            '{"target": 1, "habit_streak": 0}',
            '{"local_date": "2026-01-02", "target": 1, "occurrence": 1, "current_streak": 3, "habit_streak": 1}',
            '2026-01-01', null, 0, 0) is null,
  'the parity checker flags a wrong streak and passes a right one');

select diag('stats: ' || (select string_agg(k || '=' || n, ', ' order by k) from stats));
select lives_ok($$set constraints all immediate$$, 'deferred FKs hold');
select * from finish();
rollback;
