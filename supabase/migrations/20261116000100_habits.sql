-- Phase 3: habits — RLS, column privileges, 20-active cap, archive/unarchive/reorder.
-- Every SECURITY DEFINER function sets search_path = '' and schema-qualifies names.
-- Habits are never deleted by clients: completions (Phase 4) will reference them,
-- so they are archived instead.

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- The trigger trims all leading/trailing whitespace; \S rejects blank titles
  -- made only of tabs or newlines too.
  title text not null
    constraint habits_title_length check (
      char_length(title) between 1 and 60 and title ~ '\S'),
  description text
    constraint habits_description_length check (char_length(description) <= 280),
  category public.habit_category not null,
  difficulty public.habit_difficulty not null default 'medium',
  icon text
    constraint habits_icon_length check (char_length(icon) between 1 and 32),
  color text
    constraint habits_color_token
    check (color in ('cyan', 'violet', 'magenta', 'success', 'warning')),
  -- 0 = Sunday … 6 = Saturday (JS getDay() and Postgres extract(dow)).
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
  -- the minute, sorts and de-duplicates.
  reminder_times time[] not null default '{}'
    constraint habits_reminder_times_valid check (
      cardinality(reminder_times) <= 5
      and (cardinality(reminder_times) = 0 or array_ndims(reminder_times) = 1)
      and array_position(reminder_times, null) is null
    ),
  reminders_enabled boolean not null default true,
  -- Analytics + suggestion matching only; never trusted (DECISIONS § Phase 3).
  template_key text
    constraint habits_template_key_format check (template_key ~ '^[a-z0-9_]{1,40}$'),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index habits_user_active_idx on public.habits (user_id, sort_order)
  where archived_at is null;
create index habits_user_idx on public.habits (user_id);

alter table public.habits enable row level security;

-- ── Normalise + cap ─────────────────────────────────────────────────────────
-- SECURITY DEFINER so the count sees every row of the user regardless of RLS.
-- The per-user advisory lock serialises concurrent inserts/unarchives, so two
-- parallel requests at 19 active habits can't both pass the check.
create function public.habits_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
begin
  -- unnest() below would silently flatten {{1,2},{3,4}}: reject it first.
  if coalesce(array_ndims(new.days_of_week), 1) <> 1
     or coalesce(array_ndims(new.reminder_times), 1) <> 1 then
    raise exception 'days_of_week and reminder_times must be flat lists'
      using errcode = '23514';
  end if;

  new.title := regexp_replace(new.title, '^\s+|\s+$', '', 'g');
  new.days_of_week := array(
    select distinct d from unnest(new.days_of_week) as d order by d);
  new.reminder_times := array(
    select distinct date_trunc('minute', t)::time
    from unnest(new.reminder_times) as t order by 1);

  if new.archived_at is null
     and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('qx.habits.' || new.user_id::text, 0));
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

create trigger habits_before_write
  before insert or update on public.habits
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
grant insert (title, description, category, difficulty, icon, color,
              days_of_week, target_per_day, reminder_times, reminders_enabled,
              template_key, sort_order)
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
  update public.habits
     set archived_at = coalesce(archived_at, now())
   where id = p_habit_id and user_id = v_uid;
  if not found then
    raise exception 'Habit not found' using errcode = 'P0002';
  end if;
end;
$$;

/** Restore an archived habit. Idempotent; the 20-active cap applies. */
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
  update public.habits
     set archived_at = null,
         -- Back at the end of the list.
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
  -- Same lock as the cap, so the active set can't change underneath us.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qx.habits.' || v_uid::text, 0));
  select count(*) into v_active
  from public.habits where user_id = v_uid and archived_at is null;

  if p_habit_ids is null
     or cardinality(p_habit_ids) <> v_active
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
grant execute on function public.habits_before_write() to service_role;

revoke execute on function public.archive_habit(uuid) from public, anon;
revoke execute on function public.unarchive_habit(uuid) from public, anon;
revoke execute on function public.reorder_habits(uuid[]) from public, anon;
grant execute on function public.archive_habit(uuid) to authenticated;
grant execute on function public.unarchive_habit(uuid) to authenticated;
grant execute on function public.reorder_habits(uuid[]) to authenticated;
