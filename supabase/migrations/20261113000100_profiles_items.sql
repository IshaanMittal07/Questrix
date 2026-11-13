-- Phase 2: profiles, cosmetics catalogue + inventory, signup trigger (plan §5, §6.4).
-- Every SECURITY DEFINER function sets search_path = '' and schema-qualifies names.

create extension if not exists citext with schema extensions;

-- ── Enums (plan §5.1; all created now so later phases only add tables) ─────────
create type public.habit_difficulty as enum ('easy', 'medium', 'hard');
create type public.habit_category as enum (
  'health', 'fitness', 'mind', 'learning', 'career', 'self_care',
  'nutrition', 'finance', 'social', 'other'
);
create type public.item_category as enum (
  'avatar_base', 'outfit', 'accessory', 'name_color', 'name_style', 'title',
  'background', 'border', 'consumable'
);
create type public.item_rarity as enum ('common', 'rare', 'epic', 'legendary');
create type public.ledger_reason as enum (
  'completion', 'streak_milestone', 'purchase', 'undo', 'admin_adjust', 'refund'
);
create type public.report_status as enum ('open', 'actioned', 'dismissed');

-- ── profiles ──────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    check (username::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio text check (char_length(bio) <= 160),
  timezone text not null default 'UTC',
  points_balance int not null default 0 check (points_balance >= 0),
  lifetime_points int not null default 0,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_streak_date date,
  streak_run_started date,
  streak_freezes int not null default 0 check (streak_freezes between 0 and 2),
  is_private bool not null default false,
  -- Set (server-side) the first time the user picks their own username.
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.profiles.onboarded_at is
  'Set by trigger when the user first chooses a username (onboarding step 1). Not client-writable.';

-- Timezone must be a real IANA name. A trigger, not a CHECK: pg_timezone_names isn't immutable.
create function public.profiles_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  if tg_op = 'UPDATE'
     and new.username is distinct from old.username
     and new.onboarded_at is null then
    new.onboarded_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_validate
  before insert or update on public.profiles
  for each row execute function public.profiles_validate();

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Clients can never write points/streak/onboarding columns, even on their own row.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, timezone, is_private)
  on public.profiles to authenticated;

-- ── items (catalogue; read-only to clients) ───────────────────────────────────
create table public.items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  category public.item_category not null,
  rarity public.item_rarity not null default 'common',
  price int not null default 0 check (price >= 0),
  asset jsonb not null default '{}'::jsonb,
  level_required int not null default 1,
  is_active bool not null default true,
  is_default bool not null default false
);

create index items_category_idx on public.items (category) where is_active;

alter table public.items enable row level security;

create policy "items: active items are readable"
  on public.items for select to authenticated
  using (is_active);

revoke all on public.items from anon, authenticated;
grant select on public.items to authenticated;

-- ── user_items (inventory; written only by SECURITY DEFINER code) ─────────────
create table public.user_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index user_items_item_idx on public.user_items (item_id);

alter table public.user_items enable row level security;

create policy "user_items: owner can read"
  on public.user_items for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_items from anon, authenticated;
grant select on public.user_items to authenticated;

-- ── equipped_cosmetics (public; written only via equip_item / signup) ─────────
create table public.equipped_cosmetics (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  avatar_base_id uuid references public.items (id),
  outfit_id uuid references public.items (id),
  accessory_id uuid references public.items (id),
  name_color_id uuid references public.items (id),
  name_style_id uuid references public.items (id),
  title_id uuid references public.items (id),
  background_id uuid references public.items (id),
  border_id uuid references public.items (id)
);

alter table public.equipped_cosmetics enable row level security;

create policy "equipped_cosmetics: readable by signed-in users"
  on public.equipped_cosmetics for select to authenticated
  using (true);

revoke all on public.equipped_cosmetics from anon, authenticated;
grant select on public.equipped_cosmetics to authenticated;

-- ── Free default items (production data, not just seed) ───────────────────────
insert into public.items (slug, name, description, category, rarity, price, asset, is_default) values
  ('base-nova',   'Nova',        'Light skin tone',        'avatar_base', 'common', 0, '{"svg":"/cosmetics/avatar_base/base-nova.svg"}',   true),
  ('base-sol',    'Sol',         'Medium-light skin tone', 'avatar_base', 'common', 0, '{"svg":"/cosmetics/avatar_base/base-sol.svg"}',    true),
  ('base-terra',  'Terra',       'Medium-dark skin tone',  'avatar_base', 'common', 0, '{"svg":"/cosmetics/avatar_base/base-terra.svg"}',  true),
  ('base-umbra',  'Umbra',       'Dark skin tone',         'avatar_base', 'common', 0, '{"svg":"/cosmetics/avatar_base/base-umbra.svg"}',  true),
  ('starter-tee', 'Starter Tee', 'Every hero starts somewhere.', 'outfit', 'common', 0, '{"svg":"/cosmetics/outfit/starter-tee.svg"}', true),
  ('rookie',      'Rookie',      'Fresh off the launch pad.',    'title',  'common', 0, '{"text":"Rookie"}', true),
  ('grid-void',   'Grid Void',   'The endless neon grid.',       'background', 'common', 0, '{"svg":"/cosmetics/background/grid-void.svg"}', true),
  ('plain',       'Plain',       'A clean frame.',               'border', 'common', 0, '{"svg":"/cosmetics/border/plain.svg"}', true);

-- ── Signup: profile + default inventory + equipped row ────────────────────────
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    -- Placeholder until onboarding; matches ^[a-z0-9_]{3,20}$ and is unique per user.
    'user_' || substr(replace(new.id::text, '-', ''), 1, 12),
    left(v_name, 40)
  );

  insert into public.user_items (user_id, item_id)
  select new.id, i.id from public.items i where i.is_default and i.is_active;

  insert into public.equipped_cosmetics (
    user_id, avatar_base_id, outfit_id, title_id, background_id, border_id
  )
  values (
    new.id,
    (select id from public.items where slug = 'base-nova'),
    (select id from public.items where slug = 'starter-tee'),
    (select id from public.items where slug = 'rookie'),
    (select id from public.items where slug = 'grid-void'),
    (select id from public.items where slug = 'plain')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── public_profiles: what other users may see (plan §5.3) ─────────────────────
-- Owned by postgres without security_invoker, so it bypasses base-table RLS and
-- exposes only public columns; stats are null for private profiles (except owner).
create view public.public_profiles as
select
  p.id,
  p.username,
  p.display_name,
  p.bio,
  p.is_private,
  p.created_at,
  case when p.is_private and p.id is distinct from (select auth.uid()) then null else p.lifetime_points end as lifetime_points,
  case when p.is_private and p.id is distinct from (select auth.uid()) then null else p.current_streak end as current_streak,
  case when p.is_private and p.id is distinct from (select auth.uid()) then null else p.longest_streak end as longest_streak
from public.profiles p
where p.onboarded_at is not null or p.id = (select auth.uid());

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- ── RPCs ──────────────────────────────────────────────────────────────────────
-- Username availability for the onboarding picker (case-insensitive via citext).
create function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_username ~ '^[a-z0-9_]{3,20}$'
    and p_username not in (
      'admin', 'administrator', 'root', 'support', 'help', 'questrix', 'system',
      'mod', 'moderator', 'staff', 'official', 'settings', 'today', 'habits',
      'feed', 'shop', 'profile', 'leaderboard', 'login', 'logout', 'signup',
      'onboarding', 'auth', 'api', 'u', 'me', 'null', 'undefined'
    )
    and not exists (
      select 1 from public.profiles
      where username = p_username::extensions.citext
        and id is distinct from (select auth.uid())
    );
$$;

-- Equip an owned item into its slot (null = unequip; avatar_base can't be empty).
create function public.equip_item(p_slot text, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_category public.item_category;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_slot not in ('avatar_base', 'outfit', 'accessory', 'name_color',
                    'name_style', 'title', 'background', 'border') then
    raise exception 'Unknown slot: %', p_slot using errcode = '22023';
  end if;

  if p_item_id is null then
    if p_slot = 'avatar_base' then
      raise exception 'An avatar base is required' using errcode = '22023';
    end if;
  else
    select i.category into v_category
    from public.items i
    join public.user_items ui on ui.item_id = i.id and ui.user_id = v_uid
    where i.id = p_item_id;

    if not found then
      raise exception 'You do not own that item' using errcode = '42501';
    end if;
    if v_category::text <> p_slot then
      raise exception 'That item does not fit the % slot', p_slot using errcode = '22023';
    end if;
  end if;

  update public.equipped_cosmetics set
    avatar_base_id = case when p_slot = 'avatar_base' then p_item_id else avatar_base_id end,
    outfit_id      = case when p_slot = 'outfit'      then p_item_id else outfit_id end,
    accessory_id   = case when p_slot = 'accessory'   then p_item_id else accessory_id end,
    name_color_id  = case when p_slot = 'name_color'  then p_item_id else name_color_id end,
    name_style_id  = case when p_slot = 'name_style'  then p_item_id else name_style_id end,
    title_id       = case when p_slot = 'title'       then p_item_id else title_id end,
    background_id  = case when p_slot = 'background'  then p_item_id else background_id end,
    border_id      = case when p_slot = 'border'      then p_item_id else border_id end
  where user_id = v_uid;
end;
$$;

-- ── Function privileges ───────────────────────────────────────────────────────
revoke execute on function public.profiles_validate() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.profiles_validate() to service_role;
grant execute on function public.handle_new_user() to service_role;

revoke execute on function public.username_available(text) from public, anon;
revoke execute on function public.equip_item(text, uuid) from public, anon;
grant execute on function public.username_available(text) to authenticated;
grant execute on function public.equip_item(text, uuid) to authenticated;
