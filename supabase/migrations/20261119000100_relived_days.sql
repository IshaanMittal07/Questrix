-- Phase 4 (#81): a move west must not let a user complete a day they
-- already missed (security audit of PR #80, M1).
--
-- The latest daily_schedule date is the furthest local date the user has
-- reached: every engine call snapshots its today, and every timezone change
-- snapshots the old today first. A first completion on an earlier date that
-- is after last_streak_date (or with no streak yet) is on a relived day that
-- was never counted. It earns points, but the streak, freezes and milestones
-- don't change and the day stays uncounted, so when the reached day comes the
-- relived day is still a miss. Days already counted keep rule 0 (no change).
--
-- get_today reports such a day as `relived`: the streak is judged as of the
-- reached day, no freezes are needed, and it's never at risk.
--
-- Per-habit streaks are unchanged: they carry no points or milestones
-- (DECISIONS, #81).

create or replace function public.complete_habit_at(p_uid uuid, p_habit_id uuid, p_now timestamptz)
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
  -- The streak was set this call (first ever, increment, freeze or reset),
  -- as opposed to rules 0/1, which leave it alone. Milestones key off this.
  v_streak_set boolean := false;
  -- The furthest local date this user has reached (#81).
  v_reached date;
  v_relived boolean := false;
begin
  if p_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- 1. Profile first, NO KEY UPDATE (D5): serialises this user's engine calls
  --    without blocking foreign-key checks.
  select * into p from public.profiles where id = p_uid for no key update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if p.onboarded_at is null then
    raise exception 'Finish onboarding first' using errcode = 'QX107';
  end if;

  -- 2. Snapshot today before locking the habit row (D5).
  v_today := public.ensure_daily_schedule(p_uid, p_now);
  -- Every timezone change snapshots the old today first, and every engine
  -- call snapshots its own, so the latest snapshot is the furthest local
  -- date reached. A date before it is being relived after a move west.
  select max(s.local_date) into v_reached
  from public.daily_schedule s where s.user_id = p_uid;

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
  if v_first_today and v_today < v_reached
     and (v_last is null or v_today > v_last) then
    -- A relived day that was never counted (#81): points, but no streak
    -- change, and the day stays uncounted. Counting it would let a user who
    -- missed it move west and complete it after the fact; left uncounted,
    -- it's still a missed day when the reached day comes. Undo has nothing
    -- to restore.
    v_relived := true;
  elsif v_first_today then
    if v_last is null then
      -- First completion ever: rule 5.
      v_streak := 1;
      v_run := v_today;
      v_last := v_today;
      v_streak_set := true;
    elsif v_today <= v_last then
      -- Rules 0 (moved west: an already-counted day) and 1 share this
      -- branch: no change.
      null;
    else
      -- null = broken: a gap longer than the lookback, freezes untouched.
      v_missed := case when v_today - v_last - 1 > v_lookback then null
                       else public.streak_missed_days(p_uid, v_last, v_today) end;
      if v_missed = 0 then
        v_streak := v_streak + 1;
      elsif v_missed <= v_freezes then
        v_freezes := v_freezes - v_missed;
        v_streak := v_streak + 1;
      else
        v_streak := 1;
        v_run := v_today;
      end if;
      -- A run date is always set by now; defend against hand-edited rows.
      v_run := coalesce(v_run, v_today);
      v_last := v_today;
      v_streak_set := true;
    end if;
    v_longest := greatest(v_longest, v_streak);

    insert into public.daily_progress as d
      (user_id, local_date, completed_count, counted_for_streak,
       streak_before, longest_streak_before, last_streak_date_before,
       streak_freezes_before, streak_run_started_before, streak_freezes_used)
    values (p_uid, v_today, 0, true,
            p.current_streak, p.longest_streak, p.last_streak_date,
            p.streak_freezes, p.streak_run_started, p.streak_freezes - v_freezes)
    on conflict (user_id, local_date) do update
      set counted_for_streak = true,
          streak_before = excluded.streak_before,
          longest_streak_before = excluded.longest_streak_before,
          last_streak_date_before = excluded.last_streak_date_before,
          streak_freezes_before = excluded.streak_freezes_before,
          streak_run_started_before = excluded.streak_run_started_before,
          streak_freezes_used = excluded.streak_freezes_used;
  end if;

  -- 7. Points: floor(base × multiplier), the multiplier rounded to 2 dp so
  --    the stored value reproduces the award (plan §6.1).
  v_base := (public.economy_value('base_points') ->> v_difficulty::text)::int;
  --    A relived day pays the base multiplier: the stored streak may already
  --    be lost as of the reached day, and must not pay more than it (#81).
  v_mult := round(1 + (public.economy_value('multiplier_step'))::numeric
                      * least(case when v_relived then 1 else greatest(v_streak, 1) end,
                              (public.economy_value('multiplier_cap'))::int), 2);
  v_points := floor(v_base * v_mult)::int;

  -- 8. Per-habit streak: advances when the day's count first reaches the
  --    snapshotted target. Every completion of the day stores the pre-day
  --    state (the pin below enforces it after a relived day), so undoing
  --    any one of them restores it exactly.
  select * into hs from public.habit_streaks where habit_id = p_habit_id;
  -- Reported as-is unless the target is reached below.
  v_hcur := coalesce(hs.current, 0);
  v_hlong := coalesce(hs.longest, 0);
  v_hlast := hs.last_date;

  -- The profile lock makes a clash unreachable for one user; on conflict
  -- is the backstop, reported as the same "already done" refusal.
  insert into public.habit_completions
    (id, habit_id, user_id, local_date, occurrence, base_points, multiplier,
     points_awarded, habit_current_before, habit_longest_before, habit_last_date_before,
     completed_at)
  values (v_completion, p_habit_id, p_uid, v_today, v_occurrence, v_base, v_mult,
          v_points, hs.current, hs.longest, hs.last_date, p_now)
  on conflict on constraint habit_completions_occurrence_unique do nothing;
  if not found then
    raise exception 'Already done % of % today', v_target, v_target using errcode = 'QX103';
  end if;

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
    -- Completions of this day saved the streak as it stood at their insert;
    -- a relived earlier day (after a move west) may have advanced it since.
    -- Pin them all to the pre-advance state, which is what undo restores.
    update public.habit_completions
       set habit_current_before = hs.current,
           habit_longest_before = hs.longest,
           habit_last_date_before = hs.last_date
     where habit_id = p_habit_id and local_date = v_today;
  end if;

  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (p_uid, v_points, 'completion', v_completion);

  insert into public.daily_progress as d (user_id, local_date, completed_count)
  values (p_uid, v_today, 1)
  on conflict (user_id, local_date) do update
    set completed_count = d.completed_count + 1;

  -- 9. Milestone: once per streak run, on the day the streak reaches it.
  if v_streak_set then
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
    'habit_streak', v_hcur,
    'milestone', v_milestone,
    'milestone_points', case when v_milestone is null then null else v_bonus end,
    'new_balance', p.points_balance,
    'lifetime_points', p.lifetime_points,
    'level', public.level_for(p.lifetime_points)
  );
end;
$$;

create or replace function public.get_today_at(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_today date;
  v_hour int;
  v_lookback int := (public.economy_value('streak_lookback_days'))::int;
  v_window int := (public.economy_value('undo_window_minutes'))::int;
  v_missed int := 0;
  v_streak int;
  v_scheduled int;
  v_done int;
  v_counted boolean;
  v_habits jsonb;
  v_midnight timestamptz;
  v_reached date;
  v_relived boolean;
  v_ref date;
begin
  if p_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- FOR SHARE: the response reads one consistent state (no engine call or
  -- timezone change commits mid-way). It conflicts only with the engine's
  -- FOR NO KEY UPDATE and profile updates, keeps profile-first order (D5),
  -- and allows the FOR KEY SHARE that ensure_daily_schedule's inserts take.
  select * into p from public.profiles where id = p_uid for share;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if p.onboarded_at is null then
    raise exception 'Finish onboarding first' using errcode = 'QX107';
  end if;

  v_today := public.ensure_daily_schedule(p_uid, p_now);
  v_hour := extract(hour from (p_now at time zone p.timezone))::int;
  -- The first instant of tomorrow. Where midnight happens twice (a fall-back
  -- at 01:00, e.g. Atlantic/Azores) Postgres picks the later 00:00; step back
  -- to the earlier one, when the date really changes.
  v_midnight := (v_today + 1)::timestamp at time zone p.timezone;
  if public.local_date_in(p.timezone, v_midnight - interval '1 hour') > v_today then
    v_midnight := v_midnight - interval '1 hour';
  end if;

  -- A relived day that was never counted (#81, as in complete_habit_at):
  -- completions earn points but don't touch the streak, so nothing is at
  -- risk and no freezes are needed. The streak is judged as of the
  -- furthest day reached.
  select max(s.local_date) into v_reached
  from public.daily_schedule s where s.user_id = p_uid;
  v_relived := v_today < v_reached
               and (p.last_streak_date is null or v_today > p.last_streak_date);
  v_ref := case when v_relived then v_reached else v_today end;

  -- The global streak as the next completion would see it (plan §6.2).
  v_streak := p.current_streak;
  if p.last_streak_date is null then
    v_streak := 0;
  elsif p.last_streak_date < v_ref - 1 then
    if v_ref - p.last_streak_date - 1 > v_lookback then
      v_streak := 0;
    else
      v_missed := public.streak_missed_days(p_uid, p.last_streak_date, v_ref);
      if v_missed > p.streak_freezes then
        v_streak := 0;
        v_missed := 0;
      end if;
    end if;
  end if;
  if v_relived then
    v_missed := 0;
  end if;

  select s.scheduled_count into v_scheduled
  from public.daily_schedule s where s.user_id = p_uid and s.local_date = v_today;
  select count(*)::int into v_done
  from public.habit_completions c where c.user_id = p_uid and c.local_date = v_today;
  select coalesce(d.counted_for_streak, false) into v_counted
  from public.daily_progress d where d.user_id = p_uid and d.local_date = v_today;

  -- Today's snapshot, minus habits archived since; in list order.
  select coalesce(jsonb_agg(x.habit order by x.sort_order, x.created_at, x.id), '[]'::jsonb)
  into v_habits
  from (
    select h.sort_order, h.created_at, h.id,
      jsonb_build_object(
        'id', h.id,
        'title', h.title,
        'category', h.category,
        'icon', h.icon,
        'color', h.color,
        'difficulty', sh.difficulty,
        'target', sh.target_per_day,
        'done', coalesce(cc.n, 0),
        'completions', coalesce(cc.items, '[]'::jsonb),
        'habit_streak',
          case
            when hs.last_date is null then 0
            when hs.last_date >= v_today - 1 then hs.current
            when v_today - hs.last_date - 1 > v_lookback then 0
            when public.habit_missed_days(p_uid, h.id, hs.last_date, v_today) > 0 then 0
            else hs.current
          end
      ) as habit
    from public.daily_schedule_habits sh
    join public.habits h on h.id = sh.habit_id and h.user_id = p_uid
    left join public.habit_streaks hs on hs.habit_id = h.id and hs.user_id = p_uid
    left join lateral (
      select count(*)::int as n,
             jsonb_agg(jsonb_build_object(
               'id', c.id,
               'occurrence', c.occurrence,
               'points_awarded', c.points_awarded,
               'completed_at', c.completed_at,
               -- Undo only works on today's completions (QX105), so the
               -- deadline stops at the end of the local day.
               'undoable_until', least(c.completed_at + make_interval(mins => v_window), v_midnight)
             ) order by c.occurrence) as items
      from public.habit_completions c
      where c.habit_id = h.id and c.user_id = p_uid and c.local_date = v_today
    ) cc on true
    where sh.user_id = p_uid and sh.local_date = v_today and h.archived_at is null
  ) x;

  return jsonb_build_object(
    'local_date', v_today,
    'local_hour', v_hour,
    'timezone', p.timezone,
    'username', p.username,
    'display_name', p.display_name,
    'points_balance', p.points_balance,
    'lifetime_points', p.lifetime_points,
    'level', public.level_for(p.lifetime_points),
    'current_streak', v_streak,
    'longest_streak', p.longest_streak,
    'streak_freezes', p.streak_freezes,
    -- Freezes the next completion will spend to keep the streak (0 if none).
    'freezes_needed', v_missed,
    'counted_today', coalesce(v_counted, false),
    -- #81: a day already passed in an earlier timezone; completions here
    -- earn points but don't change the streak.
    'relived', v_relived,
    'scheduled_count', coalesce(v_scheduled, 0),
    'completed_count', v_done,
    -- D7: a required day, a streak to lose, nothing done, 18:00 or later.
    'at_risk', coalesce(v_scheduled, 0) > 0
               and v_streak > 0
               and not coalesce(v_counted, false)
               and coalesce(p.last_streak_date < v_today, true)
               and v_hour >= 18
               and not v_relived,
    'undo_window_minutes', v_window,
    'habits', v_habits
  );
end;
$$;
