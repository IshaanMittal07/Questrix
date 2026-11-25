-- Phase 8: hardening. Engine rate limit (#79), admin_adjust_points (#83),
-- data export and the blocked-users list for Settings.
--
-- Error codes (D9): QX109 too many completions/undos in a minute.

-- ── #79: per-user engine rate limit ──────────────────────────────────────────
-- A trigger on the ledger instead of edits to complete_habit_at and
-- undo_completion_at: every completion and undo writes one such row while
-- holding the profile lock, so this count is serialised per user, and the
-- engine functions stay as they are (DECISIONS H1). It counts ledger rows,
-- not actions: an undo that also revokes a milestone writes two, and the
-- whole undo then rolls back with "wait a minute". 30 a minute is far above
-- what a person tapping habits does, and stops a complete/undo loop.
create function public.ledger_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only requests from a signed-in client (a JWT) are limited; internal
  -- callers (pgTAP walks, cron, service jobs) run many in one transaction.
  if new.reason in ('completion', 'undo')
     and coalesce(current_setting('request.jwt.claims', true), '') not in ('', '{}')
     and (select count(*) from public.points_ledger l
          where l.user_id = new.user_id
            and l.reason in ('completion', 'undo')
            and l.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too fast. Wait a minute and try again.' using errcode = 'QX109';
  end if;
  return new;
end;
$$;
revoke all on function public.ledger_rate_limit() from public, anon, authenticated, service_role;
create trigger points_ledger_rate_limit before insert on public.points_ledger
  for each row execute function public.ledger_rate_limit();

-- ── #83: admin adjustments move the ledger and the balance together ─────────
create function public.admin_adjust_points(p_user_id uuid, p_delta int, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance int;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'A nonzero delta is required' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  insert into public.points_ledger (user_id, delta, reason) values (p_user_id, p_delta, 'admin_adjust');
  update public.profiles set points_balance = points_balance + p_delta
  where id = p_user_id
  returning points_balance into v_balance;
  raise log 'admin_adjust_points: % % (%)', p_user_id, p_delta, coalesce(p_note, '');
  return v_balance;
end;
$$;
revoke all on function public.admin_adjust_points(uuid, int, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_points(uuid, int, text) to service_role;
-- The RPC is now the only service_role path into the ledger.
revoke insert on public.points_ledger from service_role;

-- ── Data export (Settings → Export my data) ──────────────────────────────────
create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'engine_floor_date' from public.profiles p where p.id = (select auth.uid())),
    'habits', (select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at), '[]') from public.habits h where h.user_id = (select auth.uid())),
    'completions', (select coalesce(jsonb_agg(jsonb_build_object(
        'habit_id', c.habit_id, 'local_date', c.local_date, 'occurrence', c.occurrence,
        'points_awarded', c.points_awarded, 'completed_at', c.completed_at) order by c.completed_at), '[]')
      from public.habit_completions c where c.user_id = (select auth.uid())),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
        'delta', l.delta, 'reason', l.reason, 'created_at', l.created_at) order by l.id), '[]')
      from public.points_ledger l where l.user_id = (select auth.uid())),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('slug', i.slug, 'acquired_at', ui.acquired_at)), '[]')
      from public.user_items ui join public.items i on i.id = ui.item_id where ui.user_id = (select auth.uid())),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object(
        'body', p.body, 'attachment', p.attachment, 'created_at', p.created_at, 'deleted_at', p.deleted_at)
        order by p.created_at), '[]')
      from public.posts p where p.author_id = (select auth.uid())),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object(
        'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at, 'deleted_at', c.deleted_at)
        order by c.created_at), '[]')
      from public.comments c where c.author_id = (select auth.uid())),
    'following', (select coalesce(jsonb_agg(pr.username), '[]')
      from public.follows f join public.profiles pr on pr.id = f.followee_id
      where f.follower_id = (select auth.uid())))
  where (select auth.uid()) is not null;
$$;
revoke all on function public.export_my_data() from public, anon, service_role;
grant execute on function public.export_my_data() to authenticated;

-- ── #79 (push): save_push_subscription churn limit ──────────────────────────
-- The 10-device cap counts live rows, so it can't stop a client cycling
-- garbage endpoints (RUNBOOK §5, push audit S2). Every save is an INSERT
-- (upserts included: BEFORE INSERT fires before conflict handling), counted
-- in the social event log. save_push_subscription already holds the profile
-- lock, so the count is serialised per user. QX001 with its own hint: the
-- subscribe route answers it as 429 "rate" (P5).
alter table public.social_events drop constraint social_events_kind;
alter table public.social_events add constraint social_events_kind
  check (kind in ('follow', 'like', 'push_save'));

create function public.push_subscriptions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.social_events e
      where e.user_id = new.user_id and e.kind = 'push_save'
        and e.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many notification sign-ups'
      using errcode = 'QX001', hint = 'Try again in an hour.';
  end if;
  insert into public.social_events (user_id, kind) values (new.user_id, 'push_save');
  return new;
end;
$$;
revoke all on function public.push_subscriptions_rate_limit() from public, anon, authenticated, service_role;
create trigger push_subscriptions_rate_limit before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_rate_limit();
