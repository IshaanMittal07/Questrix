-- Phase 4 (#82): archive/unarchive cycling must not make every day optional
-- (security audit of PR #80, M2).
--
-- With every habit archived, each day's snapshot has scheduled_count = 0, a
-- rest day. Unarchiving a habit adds it to today's snapshot without raising
-- the count (D1), so completing it used to increment the streak; then the
-- habit could be archived again, and skipped days never broke the streak.
--
-- daily_schedule_habits.initial marks the habits in a day's first snapshot
-- (ensure_daily_schedule). A habit that joins later (snapshot_add_habit:
-- added, unarchived or rescheduled today) earns points, but its completion
-- takes the "no change" path for the global streak and leaves the day
-- uncounted. A later completion of an initial habit still counts the day.
--
-- Per-habit streaks are unchanged: they carry no points, freezes or
-- milestones, and undo's QX108 guard relies on them advancing (DECISIONS,
-- #82, #85). get_today reports each habit's joined_late.

-- Existing rows predate the flag; treat them as initial. New rows default to
-- false (fail closed): only ensure_daily_schedule writes true.
alter table public.daily_schedule_habits
  add column initial boolean not null default true;
alter table public.daily_schedule_habits
  alter column initial set default false;
comment on column public.daily_schedule_habits.initial is
  'In the day''s first snapshot (#82). Habits that join later don''t count the day for the global streak.';

create or replace function public.ensure_daily_schedule(p_uid uuid, p_now timestamptz)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_onboarded timestamptz;
  v_today date;
  v_first date;
  v_day date;
  v_max int;
  v_lookback int;
  v_count int;
begin
  select p.timezone, p.onboarded_at into v_tz, v_onboarded
  from public.profiles p where p.id = p_uid;
  if v_tz is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  v_today := public.local_date_in(v_tz, p_now);
  if v_onboarded is null then
    return v_today;
  end if;
  -- Fast path: a call that claims today has walked the window before it.
  -- After a move west the window can reach a day or two further back than
  -- any earlier call did; those days stay missing. That's deliberate: they
  -- were never snapshotted, so only an edited schedule could fill them now,
  -- and a missing day counts as missed (fail closed, D2).
  if exists (select 1 from public.daily_schedule s
             where s.user_id = p_uid and s.local_date = v_today) then
    return v_today;
  end if;

  v_max := (public.economy_value('schedule_max_habits'))::int;
  v_lookback := (public.economy_value('streak_lookback_days'))::int;
  v_first := greatest(v_today - v_lookback, public.local_date_in(v_tz, v_onboarded));
  -- Integer steps over dates: generate_series(date, date, interval) works in
  -- the session timezone and can skip a day where DST changes at midnight.
  for i in 0 .. (v_today - v_first) loop
    v_day := v_first + i;
    continue when exists (
      select 1 from public.daily_schedule s
      where s.user_id = p_uid and s.local_date = v_day);

    -- Claim the day first. If another transaction is snapshotting it, this
    -- waits on the primary key, then does nothing.
    insert into public.daily_schedule (user_id, local_date, scheduled_count)
    values (p_uid, v_day, 0)
    on conflict (user_id, local_date) do nothing;
    continue when not found;

    insert into public.daily_schedule_habits
      (user_id, local_date, habit_id, difficulty, target_per_day, initial)
    select p_uid, v_day, h.id, h.difficulty, h.target_per_day, true
    from public.habits h
    where h.user_id = p_uid
      and public.local_date_in(v_tz, h.created_at) <= v_day
      and (h.archived_at is null or public.local_date_in(v_tz, h.archived_at) >= v_day)
      and extract(dow from v_day)::smallint = any (h.days_of_week)
    order by h.sort_order, h.created_at, h.id
    limit v_max;
    get diagnostics v_count = row_count;

    update public.daily_schedule s
       set scheduled_count = v_count
     where s.user_id = p_uid and s.local_date = v_day;
  end loop;
  return v_today;
end;
$$;

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
  v_relived boolean := false;
  -- The streak reported on a relived day: judged as of the floor day, as
  -- get_today does (#81).
  v_report int;
  -- In the day's first snapshot, rather than joined later (#82).
  v_initial boolean;
  v_late boolean := false;
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
  select sh.difficulty, sh.target_per_day, sh.initial into v_difficulty, v_target, v_initial
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
  if v_first_today and v_today < p.engine_floor_date
     and (v_last is null or v_today > v_last) then
    -- A relived day that was never counted (#81): points, but no streak
    -- change, and the day stays uncounted. Counting it would let a user who
    -- missed it move west and complete it after the fact; left uncounted,
    -- it's still a missed day when the reached day comes. Undo has nothing
    -- to restore.
    v_relived := true;
    v_report := v_streak;
    if v_last is null then
      v_report := 0;
    elsif v_last < p.engine_floor_date - 1 then
      if p.engine_floor_date - v_last - 1 > v_lookback
         or public.streak_missed_days(p_uid, v_last, p.engine_floor_date) > v_freezes then
        v_report := 0;
      end if;
    end if;
  elsif v_first_today and not v_initial then
    -- A habit that joined the day after its first snapshot (added,
    -- unarchived or rescheduled today, #82): points, but no streak change,
    -- and the day stays uncounted. Otherwise a user could keep everything
    -- archived, so every day is a rest day, and unarchive one habit on the
    -- days they choose to grow the streak. The multiplier and the reported
    -- streak are the streak as judged today, as get_today shows it.
    v_late := true;
    v_report := v_streak;
    if v_last is null then
      v_report := 0;
    elsif v_last < v_today - 1 then
      if v_today - v_last - 1 > v_lookback
         or public.streak_missed_days(p_uid, v_last, v_today) > v_freezes then
        v_report := 0;
      end if;
    end if;
  elsif v_first_today then
    if v_last is null then
      -- First completion ever: rule 5.
      v_streak := 1;
      v_run := v_today;
      v_last := v_today;
      v_streak_set := true;
    elsif v_today <= v_last then
      -- Rules 0 (moved west: an already-counted day) and 1 share this
      -- branch: no change. Uncounted relived days took the branch above.
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
                      * least(case when v_relived then 1
                                   when v_late then greatest(v_report, 1)
                                   else greatest(v_streak, 1) end,
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
    'current_streak', case when v_relived or v_late then v_report else p.current_streak end,
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
  v_floor date;
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
  -- risk and no freezes are needed. The streak is judged as of the floor.
  v_floor := p.engine_floor_date;
  v_relived := coalesce(v_today < v_floor
               and (p.last_streak_date is null or v_today > p.last_streak_date), false);
  v_ref := case when v_relived then v_floor else v_today end;

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
        -- #82: joined today after the first snapshot; completing it
        -- earns points but doesn't count the day for the streak.
        'joined_late', not sh.initial,
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

/**
 * #82: as in 20261117000400, except that the day's streak state is restored
 * once no completion of an initial habit remains on it. Late joiners'
 * completions may remain: they keep their points but never count the day.
 */
create or replace function public.undo_completion_at(p_uid uuid, p_completion_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  c public.habit_completions%rowtype;
  d public.daily_progress%rowtype;
  v_today date;
  v_window int := (public.economy_value('undo_window_minutes'))::int;
  v_remaining int;
  v_restore_day boolean;
  v_milestone_points int := 0;
  v_cost int;
  v_target smallint;
  v_habit_done int;
  v_drops boolean;
  hs public.habit_streaks%rowtype;
  m record;
  v_revoked int[] := '{}';
begin
  if p_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Profile first, NO KEY UPDATE (D5).
  select * into p from public.profiles where id = p_uid for no key update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  select * into c from public.habit_completions
  where id = p_completion_id and user_id = p_uid
  for update;
  if not found then
    raise exception 'Completion not found' using errcode = 'P0002';
  end if;

  v_today := public.local_date_in(p.timezone, p_now);
  if c.local_date <> v_today then
    raise exception 'You can only undo today''s completions' using errcode = 'QX105';
  end if;
  if p_now > c.completed_at + make_interval(mins => v_window) then
    raise exception 'Undo is only possible for % minutes', v_window using errcode = 'QX104';
  end if;

  select * into d from public.daily_progress
  where user_id = p_uid and local_date = c.local_date;
  select count(*) - 1 into v_remaining from public.habit_completions
  where user_id = p_uid and local_date = c.local_date;
  -- #82: the day was counted by a completion of an initial habit. Once no
  -- such completion remains, restore it, even if late joiners' completions
  -- are left: they never count a day on their own.
  v_restore_day := coalesce(d.counted_for_streak, false) and not exists (
    select 1 from public.habit_completions hc
    join public.daily_schedule_habits sh
      on sh.user_id = hc.user_id and sh.local_date = hc.local_date and sh.habit_id = hc.habit_id
    where hc.user_id = p_uid and hc.local_date = c.local_date and hc.id <> c.id and sh.initial);

  -- Only the latest counted day can be emptied; fail closed otherwise.
  if v_restore_day and p.last_streak_date is distinct from c.local_date then
    raise exception 'A later day already counts on this one' using errcode = 'QX108';
  end if;

  -- Per-habit: does this undo take the day below its target?
  select sh.target_per_day into v_target from public.daily_schedule_habits sh
  where sh.user_id = p_uid and sh.local_date = c.local_date and sh.habit_id = c.habit_id;
  select count(*) into v_habit_done from public.habit_completions hc
  where hc.habit_id = c.habit_id and hc.local_date = c.local_date;
  -- A missing snapshot row is unreachable (they're deleted together); a
  -- null target counts as dropping, so the guard below fails closed.
  v_drops := coalesce(v_habit_done >= v_target, true);
  select * into hs from public.habit_streaks where habit_id = c.habit_id;
  if v_drops and hs.last_date is distinct from c.local_date then
    raise exception 'A later day already counts on this one' using errcode = 'QX108';
  end if;

  if v_restore_day then
    select coalesce(sum(sm.points), 0) into v_milestone_points
    from public.streak_milestones_awarded sm
    where sm.user_id = p_uid and sm.awarded_on = c.local_date;
  end if;

  v_cost := c.points_awarded + v_milestone_points;
  if p.points_balance < v_cost then
    raise exception 'Those points were already spent' using errcode = 'QX106';
  end if;

  -- The completion and its points.
  delete from public.habit_completions where id = c.id;
  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (p_uid, -c.points_awarded, 'undo', c.id);

  -- Per-habit streak.
  if v_drops then
    if c.habit_current_before is null then
      delete from public.habit_streaks where habit_id = c.habit_id;
    else
      update public.habit_streaks
         set current = c.habit_current_before,
             longest = c.habit_longest_before,
             last_date = c.habit_last_date_before
       where habit_id = c.habit_id;
    end if;
    -- Later days' completions saved this day's streak; give them the restored one.
    update public.habit_completions
       set habit_current_before = c.habit_current_before,
           habit_longest_before = c.habit_longest_before,
           habit_last_date_before = c.habit_last_date_before
     where habit_id = c.habit_id and local_date > c.local_date;
  end if;

  -- The day: one fewer completion; a restored day can count again.
  update public.daily_progress
     set completed_count = completed_count - 1,
         counted_for_streak = case when v_restore_day or v_remaining = 0 then false
                                   else counted_for_streak end
   where user_id = p_uid and local_date = c.local_date;

  if v_restore_day then
    for m in
      delete from public.streak_milestones_awarded sm
       where sm.user_id = p_uid and sm.awarded_on = c.local_date
      returning sm.id, sm.points, sm.milestone
    loop
      insert into public.points_ledger (user_id, delta, reason, ref_id)
      values (p_uid, -m.points, 'undo', m.id);
      v_revoked := v_revoked || m.milestone;
    end loop;

    update public.profiles
       set current_streak = d.streak_before,
           longest_streak = d.longest_streak_before,
           last_streak_date = d.last_streak_date_before,
           -- A delta, capped: a freeze gained since the count survives.
           streak_freezes = least(streak_freezes + d.streak_freezes_used,
                                  (public.economy_value('streak_freezes_max'))::int),
           streak_run_started = d.streak_run_started_before
     where id = p_uid;
  end if;

  update public.profiles
     set points_balance = points_balance - v_cost,
         lifetime_points = lifetime_points - v_cost
   where id = p_uid
  returning * into p;

  return jsonb_build_object(
    'undone_id', c.id,
    'local_date', c.local_date,
    'habit_id', c.habit_id,
    'points_removed', c.points_awarded,
    'milestones_revoked', to_jsonb(v_revoked),
    'milestone_points_removed', v_milestone_points,
    'current_streak', p.current_streak,
    'habit_streak', coalesce((select current from public.habit_streaks where habit_id = c.habit_id), 0),
    'new_balance', p.points_balance,
    'lifetime_points', p.lifetime_points,
    'level', public.level_for(p.lifetime_points)
  );
end;
$$;

