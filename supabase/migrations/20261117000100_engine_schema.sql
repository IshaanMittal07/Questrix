-- Phase 4: game-engine tables (plan §5.2, §6). Functions arrive in later
-- migrations (daily schedule, complete_habit, undo_completion, get_today).
-- Clients can only read their own rows; every write goes through SECURITY
-- DEFINER functions, so streaks, points and schedules can't be forged.

-- ── economy_config (DECISIONS § Phase 4, D4) ────────────────────────────────
-- Tunable numbers, read by the engine functions. Documented in ECONOMY.md.
create table public.economy_config (
  key text primary key
    constraint economy_config_key_format check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
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

/** One config value; a missing key is a server bug, so it raises. */
create function public.economy_value(p_key text)
returns jsonb
language plpgsql
stable
security definer
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
revoke all on function public.economy_value(text) from public, anon, authenticated;

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
  -- Never decreases: habits are only ever added to a day's snapshot.
  scheduled_count smallint not null default 0
    constraint daily_schedule_count_range check (scheduled_count between 0 and 20),
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
  foreign key (user_id, local_date)
    references public.daily_schedule (user_id, local_date) on delete cascade,
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
  habit_last_date_before date,
  completed_at timestamptz not null default now(),
  constraint habit_completions_occurrence_unique unique (habit_id, local_date, occurrence),
  -- A completion belongs to the habit's owner (DECISIONS § Phase 3)…
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade,
  -- …and the habit was in that day's schedule snapshot.
  foreign key (user_id, local_date, habit_id)
    references public.daily_schedule_habits (user_id, local_date, habit_id) on delete cascade
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
  -- Completion id, item id or milestone row; null when there's nothing to point at.
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index points_ledger_user_created_idx
  on public.points_ledger (user_id, created_at desc);

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
