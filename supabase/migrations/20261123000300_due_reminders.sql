-- Phase 5 (#88): which reminders and streak savers are due now (plan §7.2;
-- DECISIONS § Phase 5). Called every minute by /api/cron/reminders with the
-- service-role key. Each row is logged as it's returned, so overlapping runs
-- never send twice: at most once, not at least once (a failed send isn't
-- retried).

-- ── due_reminders ───────────────────────────────────────────────────────────
/**
 * Reminders whose local instant falls in (now − 2 min, now], both truncated
 * to the minute, in each user's timezone. Logs each one (reminder_log) and
 * returns the logged rows only.
 *
 * - A reminder's instant is (local_date + reminder_time) at time zone tz.
 *   The window can cross local midnight, so both the local date of now and
 *   of now − 2 min are tried. A time skipped by DST maps to the instant
 *   after the jump; a repeated one maps to one instant. Either way the log
 *   key sends it once.
 * - "Scheduled that day" and the target come from the day's snapshot when
 *   it exists (D1), else from the live habit. due_reminders never snapshots:
 *   that would write and lock for every user every minute.
 * - Skipped: done for the day, archived, reminders off for the habit,
 *   push_enabled off, not onboarded, no subscription (and then not logged).
 * - streak is only reported while it's live (last counted yesterday or
 *   today), so copy never claims a streak that's already lost.
 */
create function public.due_reminders(p_now timestamptz)
returns table (user_id uuid, habit_id uuid, local_date date, reminder_time time,
               title text, icon text, category text, points int, streak int)
language sql
volatile
security definer
set search_path = ''
as $$
  with win as (
    select date_trunc('minute', p_now) as hi,
           date_trunc('minute', p_now) - interval '2 minutes' as lo
  ),
  cand as (
    select h.id as habit_id, h.user_id, h.title, h.icon, h.category::text as category,
           h.difficulty, h.target_per_day, h.days_of_week, rt.t, d.local_date,
           p.current_streak, p.last_streak_date
    from win
    join public.profiles p
      on p.push_enabled and p.onboarded_at is not null
     and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    join public.habits h
      on h.user_id = p.id and h.archived_at is null and h.reminders_enabled
     and cardinality(h.reminder_times) > 0
    cross join lateral unnest(h.reminder_times) as rt(t)
    cross join lateral (
      select distinct x as local_date
      from unnest(array[(win.hi at time zone p.timezone)::date,
                        (win.lo at time zone p.timezone)::date]) as x
    ) d
    where ((d.local_date + rt.t) at time zone p.timezone) > win.lo
      and ((d.local_date + rt.t) at time zone p.timezone) <= win.hi
  ),
  due as (
    select c.*, coalesce(sh.difficulty, c.difficulty) as eff_difficulty
    from cand c
    left join public.daily_schedule s
      on s.user_id = c.user_id and s.local_date = c.local_date
    left join public.daily_schedule_habits sh
      on sh.user_id = c.user_id and sh.local_date = c.local_date and sh.habit_id = c.habit_id
    where case when s.local_date is not null then sh.habit_id is not null
               else extract(dow from c.local_date)::smallint = any (c.days_of_week) end
      and (select count(*) from public.habit_completions hc
           where hc.habit_id = c.habit_id and hc.local_date = c.local_date)
          < case when s.local_date is not null then sh.target_per_day else c.target_per_day end
  ),
  logged as (
    insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
    select d.habit_id, d.local_date, d.t, d.user_id from due d
    on conflict do nothing
    returning reminder_log.habit_id, reminder_log.local_date, reminder_log.reminder_time
  )
  select d.user_id, d.habit_id, d.local_date, d.t, d.title, d.icon, d.category,
         (public.economy_value('base_points') ->> d.eff_difficulty::text)::int,
         case when d.last_streak_date >= d.local_date - 1 then d.current_streak else 0 end
  from due d
  join logged l on l.habit_id = d.habit_id and l.local_date = d.local_date and l.reminder_time = d.t;
$$;

-- ── Streak saver ────────────────────────────────────────────────────────────
create table public.streak_saver_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
create index streak_saver_log_sent_at_idx on public.streak_saver_log (sent_at);
alter table public.streak_saver_log enable row level security;
revoke all on public.streak_saver_log from anon, authenticated;
revoke truncate, trigger, references on public.streak_saver_log from service_role;

/**
 * Users whose local 20:00 falls in the window and whose streak of 3+ is at
 * risk, exactly as get_today reports it (D7, #81 relived days, freezes, the
 * lookback). Logs each (user, local date) once.
 *
 * - A cheap pre-filter first (settings, subscription, stored streak >= 3,
 *   not counted today, 20:00 in the window), then get_today_at for the
 *   real answer, so the rules live in one place. It snapshots today, which
 *   any engine call that day would do anyway.
 * - Each user runs in its own sub-block: one failure, or a lock wait over
 *   2 s, is skipped with a warning and doesn't stop the batch. Each is a
 *   subtransaction; past 64 in one call Postgres's subtransaction cache
 *   overflows, which is fine at this scale (P7).
 */
create function public.due_streak_savers(p_now timestamptz)
returns table (user_id uuid, local_date date, streak int)
language plpgsql
volatile
security definer
set search_path = ''
-- A user whose profile is locked by another transaction (a completion, a
-- username change) is skipped after 2 s instead of stalling the batch.
set lock_timeout = '2s'
as $$
#variable_conflict use_column
declare
  v_hi timestamptz := date_trunc('minute', p_now);
  v_lo timestamptz := date_trunc('minute', p_now) - interval '2 minutes';
  r record;
  j jsonb;
begin
  for r in
    select p.id
    from public.profiles p
    where p.streak_saver_enabled and p.push_enabled and p.onboarded_at is not null
      and p.current_streak >= 3
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
      and exists (
        select 1 from unnest(array[(v_hi at time zone p.timezone)::date,
                                   (v_lo at time zone p.timezone)::date]) as x(d)
        where ((x.d + time '20:00') at time zone p.timezone) > v_lo
          and ((x.d + time '20:00') at time zone p.timezone) <= v_hi
          and (p.last_streak_date is null or p.last_streak_date < x.d))
    order by p.id
  loop
    begin
      j := public.get_today_at(r.id, p_now);
      if (j ->> 'at_risk')::boolean and (j ->> 'current_streak')::int >= 3 then
        insert into public.streak_saver_log (user_id, local_date)
        values (r.id, (j ->> 'local_date')::date)
        on conflict do nothing;
        if found then
          user_id := r.id;
          local_date := (j ->> 'local_date')::date;
          streak := (j ->> 'current_streak')::int;
          return next;
        end if;
      end if;
    exception when others then
      raise warning 'due_streak_savers: skipped a user (%)', sqlstate;
    end;
  end loop;
end;
$$;

revoke all on function public.due_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.due_streak_savers(timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz) to service_role;
grant execute on function public.due_streak_savers(timestamptz) to service_role;
