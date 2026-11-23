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
create function public.due_reminders(p_now timestamptz, p_limit int default 500)
returns table (user_id uuid, habit_id uuid, local_date date, reminder_time time,
               title text, icon text, category text, points int, streak int,
               subscriptions jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
  with win as (
    select date_trunc('minute', p_now) as hi,
           date_trunc('minute', p_now) - interval '2 minutes' as lo,
           public.economy_value('base_points') as bp
  ),
  -- Materialized so the window cuts first: the snapshot, completion and log
  -- lookups below run only for reminders actually due (review of PR #96).
  cand as materialized (
    select h.id as habit_id, h.user_id, h.title, h.icon, h.category::text as category,
           h.difficulty, h.target_per_day, h.days_of_week, h.created_at, rt.t, d.local_date,
           ((d.local_date + rt.t) at time zone p.timezone) as at,
           p.current_streak, p.last_streak_date, p.engine_floor_date
    from win
    join public.profiles p
      on p.push_enabled and p.onboarded_at is not null
     and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    -- habits_reminders_idx's predicate, repeated literally (P5).
    join public.habits h
      on h.user_id = p.id and h.archived_at is null and h.reminders_enabled
     and cardinality(h.reminder_times) > 0
    cross join lateral unnest(h.reminder_times) as rt(t)
    -- The local dates of now and now - 2 min (the window can cross
    -- midnight), and of 2 hours earlier: a late-evening DST jump can move a
    -- skipped time onto the next date.
    cross join lateral (
      select distinct x as local_date
      from unnest(array[(win.hi at time zone p.timezone)::date,
                        (win.lo at time zone p.timezone)::date,
                        ((win.lo - interval '2 hours') at time zone p.timezone)::date]) as x
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
               -- The live fallback: scheduled that weekday, and the habit
               -- existed at the reminder's moment.
               else extract(dow from c.local_date)::smallint = any (c.days_of_week)
                    and c.at >= c.created_at end
      and (select count(*) from public.habit_completions hc
           where hc.habit_id = c.habit_id and hc.local_date = c.local_date)
          < case when s.local_date is not null then sh.target_per_day else c.target_per_day end
      -- Already sent: skipped before the limit, so repeated calls page.
      and not exists (select 1 from public.reminder_log rl
                      where rl.habit_id = c.habit_id and rl.local_date = c.local_date
                        and rl.reminder_time = c.t)
    order by c.user_id, c.habit_id, c.local_date, c.t
    limit greatest(p_limit, 1)
  ),
  logged as (
    insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
    select d.habit_id, d.local_date, d.t, d.user_id from due d
    on conflict do nothing
    returning reminder_log.habit_id, reminder_log.local_date, reminder_log.reminder_time
  )
  select d.user_id, d.habit_id, d.local_date, d.t, d.title, d.icon, d.category,
         (win.bp ->> d.eff_difficulty::text)::int,
         -- Live and extendable only: counted yesterday or today, and not a
         -- relived day (#81), where completions can't extend it.
         case when d.last_streak_date >= d.local_date - 1
                   and not d.local_date < coalesce(d.engine_floor_date, '-infinity'::date)
              then d.current_streak else 0 end,
         (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint,
                                              'p256dh', s.p256dh, 'auth', s.auth) order by s.id)
          from public.push_subscriptions s where s.user_id = d.user_id)
  from due d
  cross join win
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
 *   200 ms, is skipped with a warning and doesn't stop the batch. A 4 s
 *   budget stops the loop well inside the 8 s statement timeout; the rest
 *   are picked up by the next minute's overlapping window. Each user is a
 *   subtransaction (past 64 the subtransaction cache overflows; fine at
 *   this scale), and the FOR SHARE profile locks get_today_at takes are
 *   held until the call commits, so keep batches short (P7).
 */
create function public.due_streak_savers(p_now timestamptz)
returns table (user_id uuid, local_date date, streak int, subscriptions jsonb)
language plpgsql
volatile
security definer
set search_path = ''
-- A user whose profile is locked by another transaction (a completion, a
-- username change) is skipped quickly instead of stalling the batch.
set lock_timeout = '200ms'
as $$
#variable_conflict use_column
declare
  v_hi timestamptz := date_trunc('minute', p_now);
  v_lo timestamptz := date_trunc('minute', p_now) - interval '2 minutes';
  r record;
  j jsonb;
  v_start timestamptz := clock_timestamp();
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
    -- A time budget well inside PostgREST's 8 s statement timeout: users
    -- left over are picked up by the next minute's overlapping window.
    exit when clock_timestamp() - v_start > interval '4 seconds';
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
          subscriptions := (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint,
                                                                'p256dh', s.p256dh, 'auth', s.auth) order by s.id)
                            from public.push_subscriptions s where s.user_id = r.id);
          return next;
        end if;
      end if;
    exception when others then
      raise warning 'due_streak_savers: skipped user % (%: %)', r.id, sqlstate, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.due_reminders(timestamptz, int) from public, anon, authenticated;
revoke all on function public.due_streak_savers(timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz, int) to service_role;
grant execute on function public.due_streak_savers(timestamptz) to service_role;
