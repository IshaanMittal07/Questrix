-- Phase 4 (#67): daily schedule snapshots (DECISIONS § Phase 4, D1/D2/D5) and
-- the timezone-change limit (D3, #28).
--
-- A day's snapshot records which habits were scheduled, with the difficulty
-- and target they had, before anything can change them. It's taken lazily:
-- the first engine call of a day, or any habit or timezone edit, fills today
-- and up to streak_lookback_days missing past days. Edits then only affect
-- days not yet snapshotted, so a missed day can't be turned into a rest day.

alter table public.profiles add column timezone_changed_at timestamptz;
comment on column public.profiles.timezone_changed_at is
  'Last timezone change after onboarding (#28 cooldown). Not client-writable.';

-- ── Helpers ─────────────────────────────────────────────────────────────────
/** The calendar date of p_at in p_tz (Postgres tzdata is authoritative). */
create function public.local_date_in(p_tz text, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone p_tz)::date;
$$;

/**
 * Snapshot today and any missing past days for p_uid, as of p_now in the
 * user's current timezone, and return today's local date.
 *
 * - Fills at most streak_lookback_days past days, never before the
 *   onboarding date. Existing rows are never rewritten.
 * - A day's habits: existed by then, not archived before it, scheduled on
 *   its weekday; at most schedule_max_habits, in list order. Their current
 *   difficulty and target are recorded (every edit snapshots first, so
 *   these are the values they had).
 * - scheduled_count is fixed here: habits added later in the day can be
 *   completed but don't turn a rest day into a required one (D1).
 * - Takes no profile lock (D5): the insert's FK check takes FOR KEY SHARE,
 *   which doesn't conflict with the engine's FOR NO KEY UPDATE. A concurrent
 *   snapshot of the same day waits on the primary key, then does nothing.
 * - Before onboarding (onboarded_at null) there's nothing to snapshot.
 */
create function public.ensure_daily_schedule(p_uid uuid, p_now timestamptz)
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
      (user_id, local_date, habit_id, difficulty, target_per_day)
    select p_uid, v_day, h.id, h.difficulty, h.target_per_day
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

/**
 * Add a habit to today's snapshot if it's active, scheduled today and fits
 * under the cap. Doesn't change scheduled_count (D1). Today's row must exist
 * (the BEFORE trigger made it).
 */
create function public.snapshot_add_habit(p_uid uuid, p_habit_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_max int := (public.economy_value('schedule_max_habits'))::int;
begin
  select p.timezone into v_tz from public.profiles p where p.id = p_uid;
  v_today := public.local_date_in(v_tz, p_now);
  -- Lock the day row so concurrent additions count one at a time and can't
  -- pass the cap together. NO KEY UPDATE: it doesn't block the snapshot
  -- FK checks (KEY SHARE).
  perform 1 from public.daily_schedule s
   where s.user_id = p_uid and s.local_date = v_today
   for no key update;
  if not found then
    return;
  end if;
  if (select count(*) from public.daily_schedule_habits sh
      where sh.user_id = p_uid and sh.local_date = v_today) >= v_max then
    return;
  end if;
  insert into public.daily_schedule_habits
    (user_id, local_date, habit_id, difficulty, target_per_day)
  select p_uid, v_today, h.id, h.difficulty, h.target_per_day
  from public.habits h
  where h.id = p_habit_id and h.user_id = p_uid
    and h.archived_at is null
    and extract(dow from v_today)::smallint = any (h.days_of_week)
  on conflict (user_id, local_date, habit_id) do nothing;
end;
$$;

-- ── Habits: snapshot before edits, add after ────────────────────────────────
create or replace function public.habits_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_limits jsonb;
begin
  -- Cheap shape checks before any unnest(): it would silently flatten
  -- {{1,2},{3,4}}, and a huge array would cost CPU before the CHECKs ran.
  if coalesce(array_ndims(new.days_of_week), 1) <> 1
     or coalesce(array_ndims(new.reminder_times), 1) <> 1 then
    raise exception 'days_of_week and reminder_times must be flat lists'
      using errcode = '23514';
  end if;
  if cardinality(new.days_of_week) > 7 or cardinality(new.reminder_times) > 5 then
    raise exception 'Too many days or reminder times' using errcode = '23514';
  end if;
  -- Normalising would wrap 24:00 to 00:00 before the CHECK could see it.
  if '24:00'::time = any (new.reminder_times) then
    raise exception 'Use 00:00 instead of 24:00' using errcode = '23514';
  end if;

  -- Blank titles become '' (not null) so the CHECK reports them as 23514;
  -- a missing title stays null for NOT NULL (23502).
  if new.title is not null then
    new.title := coalesce(public.habits_clean_text(new.title), '');
  end if;
  new.description := public.habits_clean_text(new.description);
  new.icon := public.habits_clean_text(new.icon);

  -- Nulls are left alone so NOT NULL still reports them (23502).
  if new.days_of_week is not null then
    new.days_of_week := array(
      select distinct d from unnest(new.days_of_week) as d order by d);
  end if;
  if new.reminder_times is not null then
    new.reminder_times := array(
      select distinct date_trunc('minute', t::interval)::time
      from unnest(new.reminder_times) as t order by 1);
  end if;

  -- habits_lock before the snapshot, as archive_habit and unarchive_habit
  -- do: taking them in the other order could deadlock with those RPCs.
  if tg_op = 'INSERT' or new.archived_at is distinct from old.archived_at then
    perform public.habits_lock(new.user_id);
  end if;

  if tg_op = 'INSERT' then
    -- Creation limits (economy_config), before the snapshot so a refused
    -- insert costs little: archive-and-recreate must not be unbounded.
    -- Rolling windows, so nobody is locked out for good. QX001 lets the UI
    -- tell a rate limit apart from invalid input (23514).
    v_limits := public.economy_value('habit_create_limits');
    if (select count(*) from public.habits h
        where h.user_id = new.user_id
          and h.created_at > now() - interval '24 hours') >= (v_limits ->> 'per_day')::int then
      raise exception 'You can create at most % habits a day', v_limits ->> 'per_day'
        using errcode = 'QX001', hint = 'Try again later.';
    end if;
    if (select count(*) from public.habits h
        where h.user_id = new.user_id
          and h.created_at > now() - interval '30 days') >= (v_limits ->> 'per_30_days')::int then
      raise exception 'You can create at most % habits in 30 days', v_limits ->> 'per_30_days'
        using errcode = 'QX001', hint = 'Unarchive an existing habit instead.';
    end if;
  end if;

  -- Snapshot today (and missing past days) before anything that changes a
  -- schedule takes effect (D1). Single-row paths only (D5): reorder doesn't
  -- reach here, because sort_order isn't in the trigger's column list.
  if tg_op = 'INSERT'
     or new.days_of_week is distinct from old.days_of_week
     or new.difficulty is distinct from old.difficulty
     or new.target_per_day is distinct from old.target_per_day
     or new.archived_at is distinct from old.archived_at then
    perform public.ensure_daily_schedule(new.user_id, now());
  end if;

  if tg_op = 'INSERT' then
    -- New habits go to the end of the active list.
    select coalesce(max(h.sort_order) + 1, 0) into new.sort_order
    from public.habits h
    where h.user_id = new.user_id and h.archived_at is null;
  end if;

  if new.archived_at is null
     and (tg_op = 'INSERT' or old.archived_at is not null) then
    -- habits_lock is already held (taken above for INSERT and for any
    -- archived_at change).
    select count(*) into v_active
    from public.habits h
    where h.user_id = new.user_id
      and h.archived_at is null
      and h.id <> new.id;
    if v_active >= 20 then
      raise exception 'You can have at most 20 active habits'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Now also snapshots before difficulty and target changes. Add any new
-- column that affects normalising, caps or schedules here: UPDATE OF also
-- won't fire for columns changed by another trigger.
drop trigger habits_before_write on public.habits;
create trigger habits_before_write
  before insert or update of title, description, icon, days_of_week,
    reminder_times, archived_at, difficulty, target_per_day
  on public.habits
  for each row execute function public.habits_before_write();

/** After an insert, unarchive or today-added weekday: join today's snapshot. */
create function public.habits_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is null
     and (tg_op = 'INSERT'
          or old.archived_at is not null
          or new.days_of_week is distinct from old.days_of_week) then
    perform public.snapshot_add_habit(new.user_id, new.id, now());
  end if;
  return null;
end;
$$;

create trigger habits_after_write
  after insert or update of days_of_week, archived_at
  on public.habits
  for each row execute function public.habits_after_write();

-- ── Profiles: timezone changes (D3, #28) ────────────────────────────────────
create or replace function public.profiles_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_today date;
  v_new_today date;
  v_cooldown int;
  v_lookback int;
begin
  -- Only validate when it changes: profiles are updated on every completion.
  if (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;

  -- After onboarding, a timezone change is limited and must not gain a
  -- streak day. During onboarding (old.onboarded_at null) it's free: step 1
  -- sets username and timezone in one update, which takes FOR UPDATE on the
  -- profile, so it mustn't snapshot either (D5).
  if tg_op = 'UPDATE' and new.timezone is distinct from old.timezone
     and old.onboarded_at is not null then
    -- A username change takes FOR UPDATE on this row, which blocks the FK
    -- checks a concurrent snapshot makes; doing both here could deadlock (D5).
    if new.username is distinct from old.username then
      raise exception 'Change your username and timezone separately'
        using errcode = 'QX002';
    end if;
    v_cooldown := (public.economy_value('timezone_change_cooldown_days'))::int;
    if old.timezone_changed_at is not null
       and old.timezone_changed_at > now() - make_interval(days => v_cooldown) then
      raise exception 'You can change your timezone once every % days', v_cooldown
        using errcode = 'QX001',
              -- In the user's (old) timezone, rounded up to the minute so
              -- a retry at that time succeeds.
              hint = 'Try again on or after '
                || to_char(date_trunc('minute',
                             (old.timezone_changed_at + make_interval(days => v_cooldown)
                              + interval '1 minute' - interval '1 microsecond')
                             at time zone old.timezone),
                           'YYYY-MM-DD HH24:MI')
                || ' (' || old.timezone || ').';
    end if;
    -- Snapshot the old timezone's days first; the profile row still holds
    -- the old timezone until this statement finishes.
    v_lookback := (public.economy_value('streak_lookback_days'))::int;
    v_old_today := public.ensure_daily_schedule(old.id, now());
    v_new_today := public.local_date_in(new.timezone, now());
    -- Moving east: the new timezone's days up to its today are the same real
    -- day as the old today. If nothing was required there (today already
    -- counted, or every day since the last counted one was a rest day), the
    -- new today inherits the counted day, so the jump can't count an extra
    -- streak day. If a scheduled day is pending, it stays pending and
    -- becomes a missed day (fail closed).
    if v_new_today > v_old_today
       and old.last_streak_date is not null
       and old.last_streak_date >= v_old_today - v_lookback
       and not exists (
         select 1 from generate_series(1, v_old_today - old.last_streak_date) as g(i)
         left join public.daily_schedule s
           on s.user_id = old.id and s.local_date = old.last_streak_date + g.i
         where s.scheduled_count is distinct from 0) then
      new.last_streak_date := greatest(old.last_streak_date, v_new_today);
    end if;
    -- Per-habit streaks, each on its own schedule: a habit inherits if it has
    -- nothing pending in the old zone (counted today, or not in any day's
    -- snapshot since its last count; a missing day fails closed).
    if v_new_today > v_old_today then
      update public.habit_streaks hs
         set last_date = greatest(hs.last_date, v_new_today)
       where hs.user_id = old.id
         and hs.last_date >= v_old_today - v_lookback
         and not exists (
           select 1 from generate_series(1, v_old_today - hs.last_date) as g(i)
           left join public.daily_schedule s
             on s.user_id = old.id and s.local_date = hs.last_date + g.i
           left join public.daily_schedule_habits sh
             on sh.user_id = old.id and sh.local_date = s.local_date
            and sh.habit_id = hs.habit_id
           where s.local_date is null or sh.habit_id is not null);
    end if;
    new.timezone_changed_at := now();
  end if;

  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    if public.is_reserved_username(new.username::text) then
      raise exception 'That username is reserved' using errcode = '23514';
    end if;
    if new.onboarded_at is null then
      new.onboarded_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- ── Privileges: everything here is internal ─────────────────────────────────
revoke all on function public.local_date_in(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_daily_schedule(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.snapshot_add_habit(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.habits_after_write()
  from public, anon, authenticated, service_role;
