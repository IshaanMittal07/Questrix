-- Phase 4 (#68): complete_habit — points, the global streak (with freezes and
-- rest days), per-habit streaks and milestones (plan §6.1, §6.2, §6.4;
-- DECISIONS § Phase 4, D5/D6/D8/D9).
--
-- Error codes (D9). The UI maps these, never the message text:
--   28000 not signed in · P0002 habit not found (or not yours)
--   QX101 not scheduled today · QX102 archived · QX103 target reached today
--   QX107 onboarding not finished

/** plan §6.3: level = floor(sqrt(lifetime_points / 50)) + 1. */
create function public.level_for(p_lifetime int)
returns int
language sql
immutable
set search_path = ''
as $$
  select floor(sqrt(greatest(p_lifetime, 0) / 50.0))::int + 1;
$$;

/**
 * Missed days strictly between p_from and p_to for the global streak: a
 * day is missed unless its snapshot says nothing was scheduled. A day with
 * no snapshot row counts as missed (fail closed, D2).
 */
create function public.streak_missed_days(p_uid uuid, p_from date, p_to date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from generate_series(1, p_to - p_from - 1) as g(i)
  left join public.daily_schedule s
    on s.user_id = p_uid and s.local_date = p_from + g.i
  where s.scheduled_count is distinct from 0;
$$;

/**
 * Missed days strictly between p_from and p_to for one habit: days whose
 * snapshot included the habit (it was scheduled and not done, or the day
 * would have advanced last_date), or days with no snapshot (fail closed).
 */
create function public.habit_missed_days(p_uid uuid, p_habit_id uuid, p_from date, p_to date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from generate_series(1, p_to - p_from - 1) as g(i)
  left join public.daily_schedule s
    on s.user_id = p_uid and s.local_date = p_from + g.i
  left join public.daily_schedule_habits sh
    on sh.user_id = p_uid and sh.local_date = s.local_date and sh.habit_id = p_habit_id
  where s.local_date is null or sh.habit_id is not null;
$$;

/**
 * Complete one occurrence of a habit for p_uid as of p_now. Internal: the
 * time seam for tests (D6). complete_habit() is the client entry point.
 */
create function public.complete_habit_at(p_uid uuid, p_habit_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_today date;
  v_archived timestamptz;
  v_difficulty public.habit_difficulty;
  v_target smallint;
  v_occurrence smallint;
  v_progress public.daily_progress%rowtype;
  v_first_today boolean;
  v_lookback int := (public.economy_value('streak_lookback_days'))::int;
  v_missed int;
  v_streak int;
  v_longest int;
  v_freezes int;
  v_run date;
  v_last date;
  v_base int;
  v_mult numeric(4, 2);
  v_points int;
  v_completion uuid := gen_random_uuid();
  hs public.habit_streaks%rowtype;
  v_done_after int;
  v_hcur int;
  v_hlong int;
  v_hlast date;
  v_milestone int;
  v_bonus int;
  v_milestone_id uuid;
begin
  if p_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- 1. Profile first, NO KEY UPDATE (D5): serialises this user's engine calls
  --    without blocking foreign-key checks.
  select * into p from public.profiles where id = p_uid for no key update;
  if not found then
    raise exception 'Habit not found' using errcode = 'P0002';
  end if;
  if p.onboarded_at is null then
    raise exception 'Finish onboarding first' using errcode = 'QX107';
  end if;

  -- 2. Snapshot today before locking the habit row (D5).
  v_today := public.ensure_daily_schedule(p_uid, p_now);

  -- 3. The habit, read under a row lock (not from client values).
  select h.archived_at into v_archived
  from public.habits h
  where h.id = p_habit_id and h.user_id = p_uid
  for share;
  if not found then
    raise exception 'Habit not found' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception 'This habit is archived' using errcode = 'QX102';
  end if;

  -- 4. Scheduled today means in today's snapshot, with its snapshotted
  --    difficulty and target (D1). The day row is read unlocked (D5).
  select sh.difficulty, sh.target_per_day into v_difficulty, v_target
  from public.daily_schedule_habits sh
  where sh.user_id = p_uid and sh.local_date = v_today and sh.habit_id = p_habit_id;
  if not found then
    raise exception 'This habit isn''t scheduled today' using errcode = 'QX101';
  end if;

  -- 5. The lowest unused occurrence (undo frees one for reuse).
  select min(g.i)::smallint into v_occurrence
  from generate_series(1, v_target) as g(i)
  where not exists (
    select 1 from public.habit_completions c
    where c.habit_id = p_habit_id and c.local_date = v_today and c.occurrence = g.i);
  if v_occurrence is null then
    raise exception 'Already done % of % today', v_target, v_target using errcode = 'QX103';
  end if;

  -- 6. Global streak, on the day's first counted completion (plan §6.2).
  select * into v_progress from public.daily_progress
  where user_id = p_uid and local_date = v_today;
  v_first_today := not coalesce(v_progress.counted_for_streak, false);
  v_streak := p.current_streak;
  v_longest := p.longest_streak;
  v_freezes := p.streak_freezes;
  v_run := p.streak_run_started;
  v_last := p.last_streak_date;
  if v_first_today then
    if v_last is null then
      -- First completion ever: rule 5.
      v_streak := 1;
      v_run := v_today;
      v_last := v_today;
    elsif v_today <= v_last then
      -- Rule 0 (moved west: an already-counted day) and rule 1: no change.
      null;
    else
      if v_today - v_last - 1 > v_lookback then
        v_missed := v_today - v_last - 1;  -- too long ago: broken
      else
        v_missed := public.streak_missed_days(p_uid, v_last, v_today);
      end if;
      if v_missed = 0 then
        v_streak := v_streak + 1;
      elsif v_missed <= v_freezes and v_today - v_last - 1 <= v_lookback then
        v_freezes := v_freezes - v_missed;
        v_streak := v_streak + 1;
      else
        v_streak := 1;
        v_run := v_today;
      end if;
      v_last := v_today;
    end if;
    v_longest := greatest(v_longest, v_streak);

    insert into public.daily_progress as d
      (user_id, local_date, completed_count, counted_for_streak,
       streak_before, longest_streak_before, last_streak_date_before,
       streak_freezes_before, streak_run_started_before)
    values (p_uid, v_today, 0, true,
            p.current_streak, p.longest_streak, p.last_streak_date,
            p.streak_freezes, p.streak_run_started)
    on conflict (user_id, local_date) do update
      set counted_for_streak = true,
          streak_before = excluded.streak_before,
          longest_streak_before = excluded.longest_streak_before,
          last_streak_date_before = excluded.last_streak_date_before,
          streak_freezes_before = excluded.streak_freezes_before,
          streak_run_started_before = excluded.streak_run_started_before;
  end if;

  -- 7. Points: floor(base × multiplier), the multiplier rounded to 2 dp so
  --    the stored value reproduces the award (plan §6.1).
  v_base := (public.economy_value('base_points') ->> v_difficulty::text)::int;
  v_mult := round(1 + (public.economy_value('multiplier_step'))::numeric
                      * least(greatest(v_streak, 1), (public.economy_value('multiplier_cap'))::int), 2);
  v_points := floor(v_base * v_mult)::int;

  -- 8. Per-habit streak: advances when the day's count first reaches the
  --    snapshotted target. Every completion of the day stores the pre-day
  --    state, so undoing any one of them restores it exactly.
  select * into hs from public.habit_streaks where habit_id = p_habit_id;
  v_hcur := coalesce(hs.current, 0);
  v_hlong := coalesce(hs.longest, 0);
  v_hlast := hs.last_date;

  insert into public.habit_completions
    (id, habit_id, user_id, local_date, occurrence, base_points, multiplier,
     points_awarded, habit_current_before, habit_longest_before, habit_last_date_before,
     completed_at)
  values (v_completion, p_habit_id, p_uid, v_today, v_occurrence, v_base, v_mult,
          v_points, hs.current, hs.longest, hs.last_date, p_now);

  select count(*) into v_done_after from public.habit_completions c
  where c.habit_id = p_habit_id and c.local_date = v_today;
  if v_done_after = v_target and (v_hlast is null or v_today > v_hlast) then
    if v_hlast is null
       or v_today - v_hlast - 1 > v_lookback
       or public.habit_missed_days(p_uid, p_habit_id, v_hlast, v_today) > 0 then
      v_hcur := 1;
    else
      v_hcur := v_hcur + 1;
    end if;
    insert into public.habit_streaks as t (habit_id, user_id, current, longest, last_date)
    values (p_habit_id, p_uid, v_hcur, greatest(v_hlong, v_hcur), v_today)
    on conflict (habit_id) do update
      set current = excluded.current, longest = excluded.longest, last_date = excluded.last_date;
  end if;

  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (p_uid, v_points, 'completion', v_completion);

  insert into public.daily_progress as d (user_id, local_date, completed_count)
  values (p_uid, v_today, 1)
  on conflict (user_id, local_date) do update
    set completed_count = d.completed_count + 1;

  -- 9. Milestone: once per streak run, on the day the streak reaches it.
  if v_first_today and v_streak is distinct from p.current_streak then
    v_bonus := (public.economy_value('milestones') ->> v_streak::text)::int;
    if v_bonus is not null then
      insert into public.streak_milestones_awarded
        (user_id, streak_run_started, milestone, points, awarded_on)
      values (p_uid, v_run, v_streak, v_bonus, v_today)
      on conflict (user_id, streak_run_started, milestone) do nothing
      returning id into v_milestone_id;
      if v_milestone_id is not null then
        v_milestone := v_streak;
        insert into public.points_ledger (user_id, delta, reason, ref_id)
        values (p_uid, v_bonus, 'streak_milestone', v_milestone_id);
      else
        v_bonus := null;
      end if;
    end if;
  end if;

  update public.profiles
     set points_balance = points_balance + v_points + coalesce(v_bonus, 0),
         lifetime_points = lifetime_points + v_points + coalesce(v_bonus, 0),
         current_streak = v_streak,
         longest_streak = v_longest,
         streak_freezes = v_freezes,
         streak_run_started = v_run,
         last_streak_date = v_last
   where id = p_uid
  returning * into p;

  return jsonb_build_object(
    'completion_id', v_completion,
    'local_date', v_today,
    'occurrence', v_occurrence,
    'target', v_target,
    'points_awarded', v_points,
    'multiplier', v_mult,
    'current_streak', p.current_streak,
    'habit_streak', coalesce((select current from public.habit_streaks where habit_id = p_habit_id), 0),
    'milestone', v_milestone,
    'milestone_points', case when v_milestone is null then null else v_bonus end,
    'new_balance', p.points_balance,
    'lifetime_points', p.lifetime_points,
    'level', public.level_for(p.lifetime_points)
  );
exception
  -- The profile lock makes this unreachable for one user; kept as a backstop.
  when unique_violation then
    raise exception 'Already done today' using errcode = 'QX103';
end;
$$;

/** Complete one occurrence of your habit (plan §6.4). */
create function public.complete_habit(p_habit_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.complete_habit_at(auth.uid(), p_habit_id, now());
$$;

revoke all on function public.level_for(int) from public, anon, service_role;
revoke all on function public.streak_missed_days(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.habit_missed_days(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_habit_at(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_habit(uuid) from public, anon, service_role;
grant execute on function public.complete_habit(uuid) to authenticated;
grant execute on function public.level_for(int) to authenticated;
