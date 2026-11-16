-- Phase 3: habits — RLS, column privileges, caps, archive/unarchive/reorder.
-- Every SECURITY DEFINER function sets search_path = '' and schema-qualifies names.
-- Habits are never deleted by clients: completions (Phase 4) will reference them,
-- so they are archived instead.

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- The trigger strips zero-width/bidi characters and trims all whitespace.
  title text not null
    constraint habits_title_valid check (
      char_length(title) between 1 and 60
      and title ~ '\S'
      and title !~ '[[:cntrl:]]'),
  -- '' is normalised to null by the trigger, so blank has one representation.
  description text
    constraint habits_description_length check (char_length(description) between 1 and 280),
  category public.habit_category not null,
  difficulty public.habit_difficulty not null default 'medium',
  icon text
    constraint habits_icon_length check (char_length(icon) between 1 and 32),
  color text
    constraint habits_color_token
    check (color in ('cyan', 'violet', 'magenta', 'success', 'warning')),
  -- 0 = Sunday … 6 = Saturday (JS getDay(); Postgres extract(dow)::smallint).
  -- The trigger sorts and de-duplicates; these checks reject the rest.
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}'
    constraint habits_days_valid check (
      cardinality(days_of_week) between 1 and 7
      and array_ndims(days_of_week) = 1
      and array_position(days_of_week, null) is null
      and days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]
    ),
  target_per_day smallint not null default 1
    constraint habits_target_range check (target_per_day between 1 and 5),
  -- Local wall-clock times in the user's timezone; the trigger truncates to
  -- the minute, sorts and de-duplicates. 24:00 would wrap to 00:00, so it's out.
  reminder_times time[] not null default '{}'
    constraint habits_reminder_times_valid check (
      cardinality(reminder_times) <= 5
      and (cardinality(reminder_times) = 0 or array_ndims(reminder_times) = 1)
      and array_position(reminder_times, null) is null
      and not ('24:00'::time = any (reminder_times))
    ),
  reminders_enabled boolean not null default true,
  -- Analytics + suggestion matching only; never trusted (DECISIONS § Phase 3).
  template_key text
    constraint habits_template_key_format check (template_key ~ '^[a-z0-9_]{1,40}$'),
  -- Set by the server on insert (end of the list); reorder_habits rewrites it.
  sort_order integer not null default 0
    constraint habits_sort_order_range check (sort_order between 0 and 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- Lets Phase 4 completions use a composite FK (habit_id, user_id), so the
  -- database guarantees a completion belongs to the habit's owner.
  constraint habits_id_user_unique unique (id, user_id)
);

-- Active list in display order (also get_today), and all habits per user
-- (archived list, FK cascade). Plan §5.2 had only (user_id) where active.
create index habits_user_active_idx on public.habits (user_id, sort_order)
  where archived_at is null;
create index habits_user_idx on public.habits (user_id);

alter table public.habits enable row level security;

-- ── Per-user lock ───────────────────────────────────────────────────────────
-- Every write that depends on the user's set of habits (insert, unarchive,
-- archive, reorder) takes this transaction-scoped lock first, so counts and
-- positions are computed against a stable set. Relies on READ COMMITTED (what
-- PostgREST uses): statements after the lock see rows committed before it.
create function public.habits_lock(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qx.habits.' || p_user_id::text, 0));
$$;

-- ── Normalise + caps ────────────────────────────────────────────────────────
-- SECURITY DEFINER so the counts see every row of the user regardless of RLS.
create function public.habits_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
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

  -- Strip zero-width and bidi-control characters, then trim all whitespace
  -- (including no-break spaces) from both ends.
  new.title := regexp_replace(
    regexp_replace(new.title, '[​-‏‪-‮⁠-⁤﻿]', '', 'g'),
    '^[\s ]+|[\s ]+$', '', 'g');
  new.description := nullif(regexp_replace(new.description, '^\s+|\s+$', '', 'g'), '');
  new.icon := nullif(btrim(new.icon), '');

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

  if tg_op = 'INSERT' then
    perform public.habits_lock(new.user_id);
    -- Creation limits: archive-and-recreate must not be unbounded.
    if (select count(*) from public.habits h
        where h.user_id = new.user_id
          and h.created_at > now() - interval '24 hours') >= 30 then
      raise exception 'You can create at most 30 habits a day'
        using errcode = '23514';
    end if;
    if (select count(*) from public.habits h where h.user_id = new.user_id) >= 200 then
      raise exception 'You can have at most 200 habits, including archived ones'
        using errcode = '23514';
    end if;
    -- New habits go to the end of the active list.
    select coalesce(max(h.sort_order) + 1, 0) into new.sort_order
    from public.habits h
    where h.user_id = new.user_id and h.archived_at is null;
  end if;

  if new.archived_at is null
     and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform public.habits_lock(new.user_id);
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

-- Not fired by sort_order-only updates (reorder_habits): nothing to normalise.
create trigger habits_before_write
  before insert or update of title, description, icon, days_of_week,
    reminder_times, archived_at
  on public.habits
  for each row execute function public.habits_before_write();

-- ── RLS: owner only, no client delete ──────────────────────────────────────
create policy "habits: owner can read"
  on public.habits for select to authenticated
  using (user_id = (select auth.uid()));

create policy "habits: owner can insert"
  on public.habits for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "habits: owner can update"
  on public.habits for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.habits from anon, authenticated;
grant select on public.habits to authenticated;
-- No sort_order on insert: the server appends. Updates may set it, but the UI
-- should use reorder_habits.
grant insert (title, description, category, difficulty, icon, color,
              days_of_week, target_per_day, reminder_times, reminders_enabled,
              template_key)
  on public.habits to authenticated;
grant update (title, description, category, difficulty, icon, color,
              days_of_week, target_per_day, reminder_times, reminders_enabled,
              template_key, sort_order)
  on public.habits to authenticated;

-- ── RPCs ────────────────────────────────────────────────────────────────────
/** Archive one of your habits. Idempotent; archived habits aren't scheduled. */
create function public.archive_habit(p_habit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  perform public.habits_lock(v_uid);
  update public.habits
     set archived_at = coalesce(archived_at, now())
   where id = p_habit_id and user_id = v_uid;
  if not found then
    raise exception 'Habit not found' using errcode = 'P0002';
  end if;
end;
$$;

/** Restore an archived habit to the end of the list. Idempotent; capped. */
create function public.unarchive_habit(p_habit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- Lock before computing max(sort_order), so concurrent unarchives can't
  -- both take the same position.
  perform public.habits_lock(v_uid);
  update public.habits
     set archived_at = null,
         sort_order = case when archived_at is null then sort_order else (
           select coalesce(max(h.sort_order) + 1, 0) from public.habits h
           where h.user_id = v_uid and h.archived_at is null) end
   where id = p_habit_id and user_id = v_uid;
  if not found then
    raise exception 'Habit not found' using errcode = 'P0002';
  end if;
end;
$$;

/**
 * Set the order of your active habits in one statement. p_habit_ids must list
 * every active habit exactly once; sort_order becomes its 0-based position.
 */
create function public.reorder_habits(p_habit_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_active integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- Cheap rejections before taking the lock (at most 20 active habits).
  if p_habit_ids is null
     or coalesce(array_ndims(p_habit_ids), 1) <> 1
     or cardinality(p_habit_ids) > 20 then
    raise exception 'The order must list each active habit exactly once'
      using errcode = '22023';
  end if;

  perform public.habits_lock(v_uid);
  select count(*) into v_active
  from public.habits where user_id = v_uid and archived_at is null;

  if cardinality(p_habit_ids) <> v_active
     or (select count(distinct x) from unnest(p_habit_ids) as x) <> v_active
     or exists (
       select 1 from unnest(p_habit_ids) as x
       where not exists (
         select 1 from public.habits h
         where h.id = x and h.user_id = v_uid and h.archived_at is null))
  then
    raise exception 'The order must list each active habit exactly once'
      using errcode = '22023';
  end if;

  update public.habits h
     set sort_order = o.pos - 1
    from unnest(p_habit_ids) with ordinality as o (id, pos)
   where h.id = o.id and h.user_id = v_uid;
end;
$$;

-- ── Function privileges ─────────────────────────────────────────────────────
revoke execute on function public.habits_before_write() from public, anon, authenticated;
revoke execute on function public.habits_lock(uuid) from public, anon, authenticated;
grant execute on function public.habits_before_write() to service_role;
grant execute on function public.habits_lock(uuid) to service_role;

revoke execute on function public.archive_habit(uuid) from public, anon;
revoke execute on function public.unarchive_habit(uuid) from public, anon;
revoke execute on function public.reorder_habits(uuid[]) from public, anon;
grant execute on function public.archive_habit(uuid) to authenticated;
grant execute on function public.unarchive_habit(uuid) to authenticated;
grant execute on function public.reorder_habits(uuid[]) to authenticated;
