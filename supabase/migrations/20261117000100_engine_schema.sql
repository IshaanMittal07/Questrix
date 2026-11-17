-- Phase 4: game-engine tables (plan §5.2, §6). Functions arrive in later
-- migrations (daily schedule, complete_habit, undo_completion, get_today).
-- Clients can only read their own rows; every write goes through SECURITY
-- DEFINER functions, so streaks, points and schedules can't be forged.

-- ── economy_config (DECISIONS § Phase 4, D4) ────────────────────────────────
-- Tunable numbers, read by the engine functions. Documented in ECONOMY.md.
-- A mis-set value would break every completion: check the shape and a sane
-- range per key (the engine functions assume these). A function, because a
-- CHECK can't contain subqueries.
create function public.economy_config_value_valid(p_key text, value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_key
      when 'base_points' then jsonb_typeof(value) = 'object'
        and value ?& array['easy', 'medium', 'hard']
        and (select bool_and(jsonb_typeof(v) = 'number' and (v)::numeric between 1 and 1000)
             from jsonb_each(value) as e(k, v))
      when 'multiplier_step' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 0 and 0.1
      when 'multiplier_cap' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 0 and 365
      when 'milestones' then jsonb_typeof(value) = 'object'
        and (select bool_and(k ~ '^[1-9][0-9]{0,3}$' and jsonb_typeof(v) = 'number'
                             and (v)::numeric between 1 and 100000)
             from jsonb_each(value) as e(k, v))
      when 'undo_window_minutes' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 1 and 1440
      when 'streak_lookback_days' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 1 and 31
      when 'streak_freezes_max' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 0 and 2
      when 'schedule_max_habits' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 1 and 50
      when 'habit_create_limits' then jsonb_typeof(value) = 'object'
        and jsonb_typeof(value -> 'per_day') = 'number'
        and jsonb_typeof(value -> 'per_30_days') = 'number'
      when 'timezone_change_cooldown_days' then jsonb_typeof(value) = 'number'
        and (value)::numeric between 0 and 365
      else true
    end;
$$;
-- Pure; service_role keeps EXECUTE so its config edits pass the CHECK.
revoke all on function public.economy_config_value_valid(text, jsonb)
  from public, anon, authenticated;

create table public.economy_config (
  key text primary key
    constraint economy_config_key_format check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint economy_config_value_valid
    check (public.economy_config_value_valid(key, value))
);

insert into public.economy_config (key, value) values
  ('base_points', '{"easy": 10, "medium": 20, "hard": 35}'),
  -- multiplier = 1 + multiplier_step × min(streak_after_today, multiplier_cap)
  ('multiplier_step', '0.01'),
  ('multiplier_cap', '50'),
  -- streak length → bonus points, once per streak run.
  ('milestones',
   '{"3": 25, "7": 75, "14": 150, "30": 400, "60": 800, "100": 1500, "180": 3000, "365": 5000}'),
  ('undo_window_minutes', '15'),
  -- Missed days are looked for at most this far back; further = broken.
  ('streak_lookback_days', '7'),
  ('streak_freezes_max', '2'),
  -- At most this many habits in one day's schedule snapshot (D1).
  ('schedule_max_habits', '20'),
  -- Habit creation rate limits (moved here from the habits trigger in #67).
  ('habit_create_limits', '{"per_day": 30, "per_30_days": 100}'),
  -- After onboarding, the timezone can change once per this many days (#28).
  ('timezone_change_cooldown_days', '7');

/**
 * One config value; a missing key is a server bug, so it raises. Security
 * invoker: its only callers are SECURITY DEFINER engine functions owned by
 * postgres, so it needs no privileges of its own.
 */
create function public.economy_value(p_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  select c.value into v from public.economy_config c where c.key = p_key;
  if not found then
    raise exception 'Missing economy_config key: %', p_key using errcode = 'P0002';
  end if;
  return v;
end;
$$;
revoke all on function public.economy_value(text) from public, anon, authenticated, service_role;

create function public.economy_config_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.economy_config_touch() from public, anon, authenticated, service_role;
create trigger economy_config_touch
  before update on public.economy_config
  for each row execute function public.economy_config_touch();

alter table public.economy_config enable row level security;
create policy "economy_config: readable by signed-in users"
  on public.economy_config for select to authenticated using (true);
revoke all on public.economy_config from anon, authenticated;
grant select on public.economy_config to authenticated;

-- ── daily_schedule (D1, D2) ─────────────────────────────────────────────────
-- The anti-cheat source for rest days: a snapshot of what was scheduled on
-- each of the user's local days, taken before any edit can change it.
create table public.daily_schedule (
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  -- Never decreases: habits are only ever added to a day's snapshot. The cap
  -- is economy_config.schedule_max_habits, enforced by ensure_daily_schedule;
  -- 50 is a hard ceiling in case the config is mis-set.
  scheduled_count smallint not null default 0
    constraint daily_schedule_count_range check (scheduled_count between 0 and 50),
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- Which habits were scheduled that day, with the difficulty and target they
-- had then. Points and "done" read these, never the live habit (D1).
create table public.daily_schedule_habits (
  user_id uuid not null,
  local_date date not null,
  habit_id uuid not null,
  difficulty public.habit_difficulty not null,
  target_per_day smallint not null
    constraint daily_schedule_habits_target_range check (target_per_day between 1 and 5),
  added_at timestamptz not null default now(),
  primary key (user_id, local_date, habit_id),
  -- Not cascade: a stray delete of a day fails instead of erasing the
  -- snapshot (and, below, completions). Deferred to commit, because account
  -- deletion removes these rows through two cascades (profiles → days and
  -- profiles → habits → snapshot) whose firing order isn't guaranteed; an
  -- immediate check could run before the snapshot rows are gone.
  foreign key (user_id, local_date)
    references public.daily_schedule (user_id, local_date)
    deferrable initially deferred,
  -- The habit belongs to the same user.
  foreign key (habit_id, user_id)
    references public.habits (id, user_id) on delete cascade
);
create index daily_schedule_habits_habit_idx
  on public.daily_schedule_habits (habit_id, local_date);

-- ── habit_completions ───────────────────────────────────────────────────────
create table public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null,
  user_id uuid not null,
  local_date date not null,
  occurrence smallint not null
    constraint habit_completions_occurrence_range check (occurrence between 1 and 5),
  base_points int not null
    constraint habit_completions_base_points_positive check (base_points > 0),
  multiplier numeric(4, 2) not null
    constraint habit_completions_multiplier_range check (multiplier between 1 and 9.99),
  points_awarded int not null
    constraint habit_completions_points_nonnegative check (points_awarded >= 0),
  -- habit_streaks before this completion, for undo.
  habit_current_before int,
  habit_longest_before int,
  habit_last_date_before date,
  completed_at timestamptz not null default now(),
  constraint habit_completions_occurrence_unique unique (habit_id, local_date, occurrence),
  -- A completion belongs to the habit's owner (DECISIONS § Phase 3)…
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade,
  -- …and the habit was in that day's schedule snapshot (deferred, not
  -- cascade: see daily_schedule_habits).
  foreign key (user_id, local_date, habit_id)
    references public.daily_schedule_habits (user_id, local_date, habit_id)
    deferrable initially deferred,
  -- Cheap invariant: the award follows the formula (plan §6.1).
  constraint habit_completions_points_formula
    check (points_awarded = floor(base_points * multiplier))
);
create index habit_completions_user_date_idx
  on public.habit_completions (user_id, local_date);

-- ── daily_progress ──────────────────────────────────────────────────────────
-- One row per user per local day with activity. The *_before columns hold the
-- profile's streak state before the day counted, so undo can restore it.
create table public.daily_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  completed_count int not null default 0
    constraint daily_progress_count_nonnegative check (completed_count >= 0),
  counted_for_streak bool not null default false,
  streak_before int,
  longest_streak_before int,
  last_streak_date_before date,
  streak_freezes_before smallint,
  streak_run_started_before date,
  primary key (user_id, local_date)
);

-- ── points_ledger ───────────────────────────────────────────────────────────
-- Append-only. Invariant: sum(delta) = profiles.points_balance.
create table public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null constraint points_ledger_delta_nonzero check (delta <> 0),
  reason public.ledger_reason not null,
  -- completion → habit_completions.id; streak_milestone → the milestone's id;
  -- undo → the completion or milestone it reverses; purchase/refund → the
  -- user_items row. No FK: ledger rows outlive what they point at.
  ref_id uuid,
  created_at timestamptz not null default now(),
  -- Engine entries always say what they're for, so the once-per-ref index
  -- below can't be bypassed with a null.
  constraint points_ledger_ref_required check (
    ref_id is not null
    or reason not in ('completion', 'streak_milestone', 'undo', 'purchase', 'refund')),
  -- The sign follows the reason; admin adjustments go either way.
  constraint points_ledger_sign check (
    case reason
      when 'completion' then delta > 0
      when 'streak_milestone' then delta > 0
      when 'refund' then delta > 0
      when 'purchase' then delta < 0
      when 'undo' then delta < 0
      else true
    end)
);
create index points_ledger_user_created_idx
  on public.points_ledger (user_id, created_at desc);
-- A completion, milestone, undo or refund is booked at most once, even on a
-- retry. (Not purchases: a consumable can be bought again with the same ref.)
create unique index points_ledger_ref_once
  on public.points_ledger (reason, ref_id)
  where reason in ('completion', 'streak_milestone', 'undo', 'refund');

-- ── habit_streaks ───────────────────────────────────────────────────────────
-- Per-habit streak (display only; no points). user_id is here, beyond plan
-- §5.2, so the owner-only policy can filter on it.
create table public.habit_streaks (
  habit_id uuid primary key,
  user_id uuid not null,
  current int not null default 0
    constraint habit_streaks_current_nonnegative check (current >= 0),
  longest int not null default 0,
  last_date date,
  constraint habit_streaks_longest_gte_current check (longest >= current),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade
);
create index habit_streaks_user_idx on public.habit_streaks (user_id);

-- ── streak_milestones_awarded ───────────────────────────────────────────────
-- Prevents awarding a milestone twice in one streak run.
create table public.streak_milestones_awarded (
  -- What its ledger entries point at (ref_id).
  id uuid not null default gen_random_uuid() unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  streak_run_started date not null,
  milestone int not null constraint streak_milestones_positive check (milestone > 0),
  points int not null constraint streak_milestones_points_positive check (points > 0),
  -- The local day it was earned on, so an undo that empties that day can
  -- revoke it.
  awarded_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, streak_run_started, milestone)
);

-- ── RLS: read your own rows; no client writes ───────────────────────────────
-- Plan §5.3: written out per table. Writes happen only in SECURITY DEFINER
-- functions owned by postgres, which bypass RLS.

alter table public.daily_schedule enable row level security;
create policy "daily_schedule: owner can read"
  on public.daily_schedule for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.daily_schedule from anon, authenticated;
grant select on public.daily_schedule to authenticated;

alter table public.daily_schedule_habits enable row level security;
create policy "daily_schedule_habits: owner can read"
  on public.daily_schedule_habits for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.daily_schedule_habits from anon, authenticated;
grant select on public.daily_schedule_habits to authenticated;

alter table public.habit_completions enable row level security;
create policy "habit_completions: owner can read"
  on public.habit_completions for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.habit_completions from anon, authenticated;
grant select on public.habit_completions to authenticated;

alter table public.daily_progress enable row level security;
create policy "daily_progress: owner can read"
  on public.daily_progress for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.daily_progress from anon, authenticated;
grant select on public.daily_progress to authenticated;

alter table public.points_ledger enable row level security;
create policy "points_ledger: owner can read"
  on public.points_ledger for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.points_ledger from anon, authenticated;
grant select on public.points_ledger to authenticated;

alter table public.habit_streaks enable row level security;
create policy "habit_streaks: owner can read"
  on public.habit_streaks for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.habit_streaks from anon, authenticated;
grant select on public.habit_streaks to authenticated;

alter table public.streak_milestones_awarded enable row level security;
create policy "streak_milestones_awarded: owner can read"
  on public.streak_milestones_awarded for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.streak_milestones_awarded from anon, authenticated;
grant select on public.streak_milestones_awarded to authenticated;

-- Supabase's default privileges give anon and authenticated USAGE/UPDATE on
-- new sequences, so a client could setval() the ledger's id and break every
-- later insert. Revoke it here and for future sequences.
revoke all on sequence public.points_ledger_id_seq from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- The ledger is append-only even for the server key; the cascade from
-- profiles still deletes (FK actions run as the table owner).
revoke update, delete, truncate, trigger on public.points_ledger from service_role;
