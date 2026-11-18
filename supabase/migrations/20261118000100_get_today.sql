-- Phase 4 (#70): get_today (plan §6.4; DECISIONS § Phase 4, D7).
--
-- One round trip for the Today screen: today's scheduled habits (from the
-- day's snapshot), their progress and undoable completions, and the
-- player's points, level and streak. It writes only through
-- ensure_daily_schedule (D7), so it's VOLATILE.
--
-- Streaks are reported as they stand now. The stored current_streak only
-- changes on the next completion, so after missed days it would overstate:
-- here a streak that the next completion would reset reads 0, using the
-- same rules (lookback, missed days, freezes) as complete_habit_at.
--
-- Error codes (D9): 28000 not signed in · P0002 profile not found ·
-- QX107 onboarding not finished. (P0002 also means a missing economy_config
-- key: a server bug, never a client case.)

/** Today for p_uid as of p_now. Internal: the time seam for tests (D6). */
create function public.get_today_at(p_uid uuid, p_now timestamptz)
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

  -- The global streak as the next completion would see it (plan §6.2).
  v_streak := p.current_streak;
  if p.last_streak_date is null then
    v_streak := 0;
  elsif p.last_streak_date < v_today - 1 then
    if v_today - p.last_streak_date - 1 > v_lookback then
      v_streak := 0;
    else
      v_missed := public.streak_missed_days(p_uid, p.last_streak_date, v_today);
      if v_missed > p.streak_freezes then
        v_streak := 0;
        v_missed := 0;
      end if;
    end if;
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
               'undoable_until', least(c.completed_at + make_interval(mins => v_window),
                                       (v_today + 1)::timestamp at time zone p.timezone)
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
    'scheduled_count', coalesce(v_scheduled, 0),
    'completed_count', v_done,
    -- D7: a required day, a streak to lose, nothing done, 18:00 or later.
    'at_risk', coalesce(v_scheduled, 0) > 0
               and v_streak > 0
               and not coalesce(v_counted, false)
               and coalesce(p.last_streak_date < v_today, true)
               and v_hour >= 18,
    'undo_window_minutes', v_window,
    'habits', v_habits
  );
end;
$$;

/** Today's habits, progress, points and streak in one call (plan §6.4). */
create function public.get_today()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select public.get_today_at(auth.uid(), now());
$$;

revoke all on function public.get_today_at(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.get_today() from public, anon, service_role;
grant execute on function public.get_today() to authenticated;
