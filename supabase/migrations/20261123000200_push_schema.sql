-- Phase 5 (#87): push subscriptions, the reminder log and notification
-- settings (plan §5.2, §7; DECISIONS § Phase 5).
--
-- Clients read and delete their own subscriptions, but write them only
-- through save_push_subscription: an endpoint is unique across users, and a
-- plain upsert by endpoint can't move a device's row to whoever signed in
-- on it last under owner-only RLS. Endpoints must be https on a known push
-- service, because the server POSTs to them (SSRF).

-- ── Settings ────────────────────────────────────────────────────────────────
alter table public.profiles
  add column push_enabled boolean not null default true,
  add column streak_saver_enabled boolean not null default true;
comment on column public.profiles.push_enabled is
  'Global switch for push reminders (Settings). Per-habit: habits.reminders_enabled.';
comment on column public.profiles.streak_saver_enabled is
  'The 20:00 local streak saver push when a streak of 3+ is at risk (plan §7.2).';
grant update (push_enabled, streak_saver_enabled) on public.profiles to authenticated;

-- ── push_subscriptions ──────────────────────────────────────────────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique
    constraint push_subscriptions_endpoint_valid check (
      length(endpoint) <= 1024
      -- Printable ASCII only (real endpoints are), so the 1024 limit is in
      -- bytes too and invisible characters can't hide in the path.
      and endpoint ~ '^[!-~]+$'
      and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.push\.apple\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com)/'
    ),
  -- An uncompressed P-256 key (65 bytes) and a 16-byte auth secret, in
  -- base64url: exact sizes, so a client can't store megabytes of padding.
  p256dh text not null
    constraint push_subscriptions_p256dh_valid check (p256dh ~ '^[A-Za-z0-9_-]{87}=?$'),
  auth text not null
    constraint push_subscriptions_auth_valid check (auth ~ '^[A-Za-z0-9_-]{22}(==)?$'),
  user_agent text
    constraint push_subscriptions_user_agent_len check (length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
comment on table public.push_subscriptions is
  'Web Push subscriptions, one per device endpoint. Written only by save_push_subscription.';

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
revoke truncate, trigger, references on public.push_subscriptions from service_role;
grant select, delete on public.push_subscriptions to authenticated;

-- ── reminder_log ────────────────────────────────────────────────────────────
-- Each (habit, local date, reminder time) is sent at most once (plan §5.2).
-- Server-only: RLS on, no policies, no client privileges.
create table public.reminder_log (
  habit_id uuid not null references public.habits (id) on delete cascade,
  local_date date not null,
  reminder_time time not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (habit_id, local_date, reminder_time)
);
create index reminder_log_user_id_idx on public.reminder_log (user_id);
create index reminder_log_sent_at_idx on public.reminder_log (sent_at);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;
revoke truncate, trigger, references on public.reminder_log from service_role;

-- Candidate habits for due_reminders (DECISIONS § Phase 3 asked for it).
create index habits_reminders_idx on public.habits (user_id)
  where archived_at is null and reminders_enabled and cardinality(reminder_times) > 0;

-- ── save_push_subscription ──────────────────────────────────────────────────
/**
 * Save this device's subscription for the signed-in user and return its id.
 * - An endpoint already saved (by anyone) moves to the caller: whoever
 *   holds the endpoint URL is that device. Its keys are replaced, and
 *   last_success_at resets when the owner changes.
 * - At most 10 per user (QX001), so a client can't fill the table. Call
 *   rate limiting is #79's (a count of live rows can't limit churn).
 * - Locks the profile FOR NO KEY UPDATE first (D5), which serialises the
 *   cap check per user: every insert of a row for this user runs after the
 *   lock, and READ COMMITTED re-reads the count after it. Other users'
 *   takeovers and deletes only lower it. NO KEY UPDATE doesn't block the
 *   FK checks' KEY SHARE, so it can't deadlock against the engine.
 */
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  perform 1 from public.profiles where id = v_uid for no key update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.push_subscriptions s
                 where s.endpoint = p_endpoint and s.user_id = v_uid) then
    if (select count(*) from public.push_subscriptions s where s.user_id = v_uid) >= 10 then
      raise exception 'You can have at most 10 devices with notifications'
        using errcode = 'QX001', hint = 'Turn notifications off on a device you no longer use.';
    end if;
  end if;

  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, nullif(left(regexp_replace(p_user_agent, '[[:cntrl:]]', '', 'g'), 512), ''))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        -- A re-save without a user agent keeps the stored one.
        user_agent = case when s.user_id = excluded.user_id
                          then coalesce(excluded.user_agent, s.user_agent) else excluded.user_agent end,
        -- A moved row gets a new id, so a sender holding the old id (#89)
        -- can't record a success or a removal against the new owner.
        id = case when s.user_id = excluded.user_id then s.id else gen_random_uuid() end,
        last_success_at = case when s.user_id = excluded.user_id then s.last_success_at end,
        created_at = case when s.user_id = excluded.user_id then s.created_at else now() end,
        user_id = excluded.user_id
  returning s.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
