-- Phase 4 (#69): undo_completion (plan §6.4; DECISIONS § Phase 4,
-- "complete_habit (#68)" → requirements for undo).
--
-- Also: daily_progress.streak_freezes_used, so undo gives freezes back as a
-- delta (a freeze bought after the count survives); lifetime_points >= 0;
-- complete_habit_at redefined to fill both and to pin a day's saved habit
-- state when the habit streak advances (security audit L1).
--
-- Error codes (D9), in addition to complete_habit's:
--   P0002 completion not found (or not yours)
--   QX104 the undo window has passed · QX105 not today's completion
--   QX106 the balance can't cover it (the points were spent)
--   QX108 a later day already built on this one (only after a move west)

alter table public.daily_progress
  add column streak_freezes_used smallint not null default 0
    constraint daily_progress_freezes_used_range check (streak_freezes_used between 0 and 2);
comment on column public.daily_progress.streak_freezes_used is
  'Freezes this day''s count spent; undo adds them back (capped), so freezes gained since survive.';

alter table public.profiles
  add constraint profiles_lifetime_points_nonnegative check (lifetime_points >= 0);

/**
 * Complete one occurrence of a habit for p_uid as of p_now. Internal: the
 * time seam for tests (D6). complete_habit() is the client entry point.
 *
 * Redefined in #69 (undo): records the freezes a day spends
 * (daily_progress.streak_freezes_used), and when a habit streak advances,
 * rewrites that day's completions to the pre-advance state, so every
 * completion of a day holds the state undo must restore.
 */
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
  v_mult := round(1 + (public.economy_value('multiplier_step'))::numeric
                      * least(greatest(v_streak, 1), (public.economy_value('multiplier_cap'))::int), 2);
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

/**
 * Undo one of p_uid's completions as of p_now. Internal: the time seam for
 * tests (D6). undo_completion() is the client entry point.
 *
 * - Only a completion from the user's current local day, within
 *   undo_window_minutes of completed_at.
 * - Refused if the balance can't cover the points plus any milestone the
 *   undo revokes, so "complete, spend, undo" can't go negative.
 * - The profile's streak state is restored from daily_progress when this
 *   empties the day and the day is the profile's last_streak_date.
 *   Milestones awarded that day are revoked (their rows deleted, so a redo
 *   can earn them again with a fresh id).
 * - The per-habit streak is restored from the completion's saved state when
 *   the day drops below its target and is the habit's last_date. A null
 *   saved state means no streak row existed: delete it. Later days'
 *   completions of the habit saved this day's streak as their before-state,
 *   so they are rewritten to the restored one.
 * - Emptying a counted day that isn't last_streak_date, or dropping a day
 *   below target when it isn't the habit's last_date (possible only after
 *   a move west, when a later day counted on top of it), is refused
 *   (QX108): the later day's streak and saved states were built on this
 *   one and can't be restored exactly (security audit M1).
 */
create function public.undo_completion_at(p_uid uuid, p_completion_id uuid, p_now timestamptz)
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
  v_restore_day := v_remaining = 0 and coalesce(d.counted_for_streak, false);

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

  -- The day: one fewer completion; an emptied day can count again.
  update public.daily_progress
     set completed_count = completed_count - 1,
         counted_for_streak = case when v_remaining = 0 then false else counted_for_streak end
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

/** Undo one of your completions from today, within the undo window. */
create function public.undo_completion(p_completion_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.undo_completion_at(auth.uid(), p_completion_id, now());
$$;

revoke all on function public.undo_completion_at(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.undo_completion(uuid) from public, anon, service_role;
grant execute on function public.undo_completion(uuid) to authenticated;
