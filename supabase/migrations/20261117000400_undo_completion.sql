-- Phase 4 (#69): undo_completion (plan §6.4; DECISIONS § Phase 4,
-- "complete_habit (#68)" → requirements for undo).
--
-- Error codes (D9), in addition to complete_habit's:
--   P0002 completion not found (or not yours)
--   QX104 the undo window has passed · QX105 not today's completion
--   QX106 the balance can't cover it (the points were spent)

/**
 * Undo one of p_uid's completions as of p_now. Internal: the time seam for
 * tests (D6). undo_completion() is the client entry point.
 *
 * - Only a completion from the user's current local day, within
 *   undo_window_minutes of completed_at.
 * - Refused if the balance can't cover the points plus any milestone the
 *   undo revokes, so "complete, spend, undo" can't go negative.
 * - The profile's streak state is restored from daily_progress only when
 *   this empties the day and the day is the profile's last_streak_date:
 *   earlier days' saved states are stale once a later day has counted.
 *   Milestones awarded that day are revoked (their rows deleted, so a redo
 *   can earn them again with a fresh id).
 * - The per-habit streak is restored from the completion's saved state only
 *   when the habit's last counted day is this day and the day drops below
 *   its target. A null saved state means no streak row existed: delete it.
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
  v_restore_day := v_remaining = 0
                   and coalesce(d.counted_for_streak, false)
                   and p.last_streak_date = c.local_date;

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
  select sh.target_per_day into v_target from public.daily_schedule_habits sh
  where sh.user_id = p_uid and sh.local_date = c.local_date and sh.habit_id = c.habit_id;
  select count(*) into v_habit_done from public.habit_completions hc
  where hc.habit_id = c.habit_id and hc.local_date = c.local_date;
  if v_habit_done < v_target
     and exists (select 1 from public.habit_streaks hs
                 where hs.habit_id = c.habit_id and hs.last_date = c.local_date) then
    if c.habit_current_before is null then
      delete from public.habit_streaks where habit_id = c.habit_id;
    else
      update public.habit_streaks
         set current = c.habit_current_before,
             longest = c.habit_longest_before,
             last_date = c.habit_last_date_before
       where habit_id = c.habit_id;
    end if;
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
           streak_freezes = d.streak_freezes_before,
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
