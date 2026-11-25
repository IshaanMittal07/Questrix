-- Phase 7: follows, blocks, posts, likes, comments, reports, the in-app inbox,
-- the weekly leaderboard and social-proof counts (plan §5, §6.6, §12).
--
-- Error codes (D9). The UI maps these, never the message text:
--   28000 not signed in · P0002 not found (or hidden from you) · QX107 onboarding not finished
--   QX301 rate limited · QX302 blocked text · QX303 blocked user · 22023 bad input

-- ── Moderation word list (mirrored in lib/moderation/blocklist.ts) ───────────
create function public.text_is_clean(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (lower(coalesce(p_text, '')) ~ '\m(fuck\w*|shit\w*|cunt\w*|bitch\w*|nigg\w*|fag\w*|retard\w*|whore\w*|slut\w*)\M');
$$;
grant execute on function public.text_is_clean(text) to authenticated;

-- ── Blocks ────────────────────────────────────────────────────────────────────
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;
create policy "blocks: owner reads" on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "blocks: owner inserts" on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "blocks: owner deletes" on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));
revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

/** True when either user has blocked the other. Definer: blocks are owner-only. */
create function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
-- Internal: with arbitrary arguments it would reveal third parties' blocks
-- (audit M1). Policies use is_blocked_with_me, bound to the caller.
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

/** True when the caller and p_other have blocked each other either way. */
create function public.is_blocked_with_me(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_blocked_between(p_other, (select auth.uid()));
$$;
revoke all on function public.is_blocked_with_me(uuid) from public, anon;
grant execute on function public.is_blocked_with_me(uuid) to authenticated;

-- ── Follows ───────────────────────────────────────────────────────────────────
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);
alter table public.follows enable row level security;
-- Follow lists are public (counts on profiles), except across a block.
create policy "follows: readable unless blocked" on public.follows for select to authenticated
  using (not public.is_blocked_with_me(follower_id)
         and not public.is_blocked_with_me(followee_id));
create policy "follows: owner inserts" on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()));
create policy "follows: owner deletes" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

-- ── Posts ─────────────────────────────────────────────────────────────────────
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null constraint posts_body_length check (char_length(body) between 1 and 1000),
  attachment jsonb,
  like_count int not null default 0 constraint posts_like_count_nonneg check (like_count >= 0),
  comment_count int not null default 0 constraint posts_comment_count_nonneg check (comment_count >= 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_feed_idx on public.posts (created_at desc, id desc) where deleted_at is null;
alter table public.posts enable row level security;
create policy "posts: visible unless deleted or blocked" on public.posts for select to authenticated
  using (deleted_at is null and not public.is_blocked_with_me(author_id));
-- No client writes: create_post / delete_post only (DECISIONS F2).
revoke all on public.posts from anon, authenticated;
grant select on public.posts to authenticated;

-- ── Likes ─────────────────────────────────────────────────────────────────────
create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);
alter table public.post_likes enable row level security;
create policy "post_likes: owner reads" on public.post_likes for select to authenticated
  using (user_id = (select auth.uid()));
-- The subquery runs under posts' RLS, so hidden or blocked posts can't be liked.
create policy "post_likes: like visible posts" on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.posts p where p.id = post_id));
create policy "post_likes: owner deletes" on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.post_likes from anon, authenticated;
grant select, insert, delete on public.post_likes to authenticated;

-- ── Comments ──────────────────────────────────────────────────────────────────
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null constraint comments_body_length check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id, created_at desc);
alter table public.comments enable row level security;
create policy "comments: visible unless deleted or blocked" on public.comments for select to authenticated
  using (deleted_at is null
         and not public.is_blocked_with_me(author_id)
         and exists (select 1 from public.posts p where p.id = post_id));
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;

-- ── Reports ───────────────────────────────────────────────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null constraint reports_target_type check (target_type in ('post', 'comment', 'user')),
  target_id uuid not null,
  reason text not null default '' constraint reports_reason_length check (char_length(reason) <= 300),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index reports_target_idx on public.reports (target_type, target_id) where status = 'open';
alter table public.reports enable row level security;
create policy "reports: owner reads" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

-- ── In-app inbox ──────────────────────────────────────────────────────────────
create table public.notifications_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null constraint notifications_inbox_type check (type in ('like', 'comment', 'follow', 'milestone')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox_user_idx on public.notifications_inbox (user_id, created_at desc);
alter table public.notifications_inbox enable row level security;
create policy "inbox: owner reads" on public.notifications_inbox for select to authenticated
  using (user_id = (select auth.uid()));
create policy "inbox: owner marks read" on public.notifications_inbox for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notifications_inbox from anon, authenticated;
grant select on public.notifications_inbox to authenticated;
grant update (read_at) on public.notifications_inbox to authenticated;

/**
 * Inbox row for p_user about p_actor; never to yourself or across a block.
 * The same (type, actor, post) goes out at most once a day, so a like/unlike
 * or follow/unfollow loop can't flood an inbox (audit H1/H2). The payload
 * holds actor_id; the name is read at display time (audit L2).
 */
create function public.notify(p_user uuid, p_actor uuid, p_type text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := p_payload || jsonb_build_object('actor_id', p_actor);
begin
  if p_user = p_actor or public.is_blocked_between(p_user, p_actor) then
    return;
  end if;
  if exists (select 1 from public.notifications_inbox n
             where n.user_id = p_user and n.type = p_type and n.payload = v_payload
               and n.created_at > now() - interval '1 day') then
    return;
  end if;
  insert into public.notifications_inbox (user_id, type, payload)
  values (p_user, p_type, v_payload);
end;
$$;
revoke all on function public.notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ── Social event log: limits count attempts, not surviving rows ─────────────
-- Unfollowing or unliking deletes the row, so counting follows or likes would
-- let a loop run forever (audit H1/H2). Server-only; pruned daily.
create table public.social_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null constraint social_events_kind check (kind in ('follow', 'like')),
  created_at timestamptz not null default now()
);
create index social_events_user_idx on public.social_events (user_id, kind, created_at desc);
alter table public.social_events enable row level security;
revoke all on public.social_events from anon, authenticated;

create function public.social_event(p_uid uuid, p_kind text, p_limit int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.social_events e
      where e.user_id = p_uid and e.kind = p_kind and e.created_at > now() - p_window) >= p_limit then
    raise exception 'Too many % actions', p_kind using errcode = 'QX301';
  end if;
  insert into public.social_events (user_id, kind) values (p_uid, p_kind);
end;
$$;
revoke all on function public.social_event(uuid, text, int, interval) from public, anon, authenticated;

create function public.cleanup_social_events()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.social_events where created_at < now() - interval '2 days';
$$;
revoke all on function public.cleanup_social_events() from public, anon, authenticated;
grant execute on function public.cleanup_social_events() to service_role;
select cron.schedule('questrix-social-events-cleanup', '23 3 * * *', 'select public.cleanup_social_events()');

-- ── Rate limits (plan §6.6) ───────────────────────────────────────────────────
/** The limit for p_kind; constants here so they're easy to find (DECISIONS F3). */
create function public.social_limit(p_kind text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'posts_hour' then 10 when 'posts_day' then 50
    when 'comments_hour' then 30 when 'follows_day' then 100
    when 'reports_day' then 20 when 'likes_hour' then 300 end;
$$;
revoke all on function public.social_limit(text) from public, anon, authenticated;

create function public.require_onboarded(p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = p_uid and onboarded_at is not null) then
    raise exception 'Finish onboarding first' using errcode = 'QX107';
  end if;
end;
$$;
revoke all on function public.require_onboarded(uuid) from public, anon, authenticated;

-- ── Follow triggers: rate limit, blocks, inbox ────────────────────────────────
create function public.follows_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_onboarded(new.follower_id);
  if public.is_blocked_between(new.follower_id, new.followee_id) then
    raise exception 'You can''t follow this user' using errcode = 'QX303';
  end if;
  if not exists (select 1 from public.profiles where id = new.followee_id and onboarded_at is not null) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  -- Serialise this user's follows so the count can't race.
  perform 1 from public.profiles where id = new.follower_id for no key update;
  perform public.social_event(new.follower_id, 'follow', public.social_limit('follows_day'), interval '1 day');
  return new;
end;
$$;
revoke all on function public.follows_before_insert() from public, anon, authenticated;
create trigger follows_before_insert before insert on public.follows
  for each row execute function public.follows_before_insert();

create function public.follows_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(new.followee_id, new.follower_id, 'follow', '{}'::jsonb);
  return null;
end;
$$;
revoke all on function public.follows_after_insert() from public, anon, authenticated;
create trigger follows_after_insert after insert on public.follows
  for each row execute function public.follows_after_insert();

-- Blocking someone removes follows both ways.
create function public.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return null;
end;
$$;
revoke all on function public.blocks_after_insert() from public, anon, authenticated;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.blocks_after_insert();

-- ── Like counter + inbox ──────────────────────────────────────────────────────
create function public.post_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id
    returning author_id into v_author;
    perform public.notify(v_author, new.user_id, 'like', jsonb_build_object('post_id', new.post_id));
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;
revoke all on function public.post_likes_count() from public, anon, authenticated;

create function public.post_likes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_onboarded(new.user_id);
  perform 1 from public.profiles where id = new.user_id for no key update;
  perform public.social_event(new.user_id, 'like', public.social_limit('likes_hour'), interval '1 hour');
  return new;
end;
$$;
revoke all on function public.post_likes_before_insert() from public, anon, authenticated;
create trigger post_likes_before_insert before insert on public.post_likes
  for each row execute function public.post_likes_before_insert();
create trigger post_likes_count after insert or delete on public.post_likes
  for each row execute function public.post_likes_count();

-- ── Weekly summary card (built from real data, never from the client) ────────
create function public.weekly_summary(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'weekly_summary',
    'streak', p.current_streak,
    'completions', (select count(*) from public.habit_completions c
                    where c.user_id = p.id
                      and c.local_date > (now() at time zone p.timezone)::date - 7),
    'points', (select coalesce(sum(l.delta), 0) from public.points_ledger l
               where l.user_id = p.id
                 and l.reason in ('completion', 'streak_milestone', 'undo')
                 and l.created_at > now() - interval '7 days'),
    'level', public.level_for(p.lifetime_points))
  from public.profiles p where p.id = p_uid;
$$;
revoke all on function public.weekly_summary(uuid) from public, anon, authenticated;

-- ── create_post / delete_post ─────────────────────────────────────────────────
create function public.create_post(p_body text, p_attach_summary boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform public.require_onboarded(v_uid);
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'Posts are 1 to 1000 characters' using errcode = '22023';
  end if;
  if not public.text_is_clean(v_body) then
    raise exception 'Please keep it friendly' using errcode = 'QX302';
  end if;
  perform 1 from public.profiles where id = v_uid for no key update;
  if (select count(*) from public.posts where author_id = v_uid and created_at > now() - interval '1 hour')
       >= public.social_limit('posts_hour')
     or (select count(*) from public.posts where author_id = v_uid and created_at > now() - interval '1 day')
       >= public.social_limit('posts_day') then
    raise exception 'You''re posting too fast' using errcode = 'QX301';
  end if;
  insert into public.posts (author_id, body, attachment)
  values (v_uid, v_body, case when p_attach_summary then public.weekly_summary(v_uid) end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_post(text, boolean) from public, anon, service_role;
grant execute on function public.create_post(text, boolean) to authenticated;

create function public.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  update public.posts set deleted_at = now()
  where id = p_post_id and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.delete_post(uuid) from public, anon, service_role;
grant execute on function public.delete_post(uuid) to authenticated;

-- ── create_comment / delete_comment ───────────────────────────────────────────
create function public.create_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_author uuid;
  v_id uuid;
begin
  perform public.require_onboarded(v_uid);
  select author_id into v_author from public.posts
  where id = p_post_id and deleted_at is null for no key update;
  if not found then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if public.is_blocked_between(v_uid, v_author) then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'Comments are 1 to 500 characters' using errcode = '22023';
  end if;
  if not public.text_is_clean(v_body) then
    raise exception 'Please keep it friendly' using errcode = 'QX302';
  end if;
  perform 1 from public.profiles where id = v_uid for no key update;
  if (select count(*) from public.comments where author_id = v_uid and created_at > now() - interval '1 hour')
       >= public.social_limit('comments_hour') then
    raise exception 'You''re commenting too fast' using errcode = 'QX301';
  end if;
  insert into public.comments (post_id, author_id, body) values (p_post_id, v_uid, v_body)
  returning id into v_id;
  update public.posts set comment_count = comment_count + 1 where id = p_post_id;
  perform public.notify(v_author, v_uid, 'comment', jsonb_build_object('post_id', p_post_id));
  return v_id;
end;
$$;
revoke all on function public.create_comment(uuid, text) from public, anon, service_role;
grant execute on function public.create_comment(uuid, text) to authenticated;

create function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  update public.comments set deleted_at = now()
  where id = p_comment_id and author_id = auth.uid() and deleted_at is null
  returning post_id into v_post;
  if not found then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  update public.posts set comment_count = greatest(comment_count - 1, 0) where id = v_post;
end;
$$;
revoke all on function public.delete_comment(uuid) from public, anon, service_role;
grant execute on function public.delete_comment(uuid) to authenticated;

-- ── report_content (auto-hide a post at 5 distinct open reports) ─────────────
create function public.report_content(p_target_type text, p_target_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  perform public.require_onboarded(v_uid);
  if p_target_type = 'post' then
    select author_id into v_owner from public.posts where id = p_target_id and deleted_at is null;
  elsif p_target_type = 'comment' then
    select author_id into v_owner from public.comments where id = p_target_id and deleted_at is null;
  elsif p_target_type = 'user' then
    select id into v_owner from public.profiles where id = p_target_id;
  else
    raise exception 'Unknown target' using errcode = '22023';
  end if;
  if v_owner is null or v_owner = v_uid then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if char_length(coalesce(p_reason, '')) > 300 then
    raise exception 'Reasons are up to 300 characters' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = v_uid for no key update;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '1 day')
     >= public.social_limit('reports_day') then
    raise exception 'Too many reports today' using errcode = 'QX301';
  end if;
  if p_target_type = 'post' then
    -- Serialise reports on one post so concurrent 5th reports can't each see 4.
    perform 1 from public.posts where id = p_target_id for no key update;
  end if;
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_uid, p_target_type, p_target_id, btrim(coalesce(p_reason, '')))
  on conflict (reporter_id, target_type, target_id) do nothing;

  -- Only accounts at least 3 days old count, so five fresh sign-ups can't
  -- hide a post (audit M3). Hidden posts keep their reports for review.
  if p_target_type = 'post' and (
       select count(distinct r.reporter_id) from public.reports r
       join public.profiles rp on rp.id = r.reporter_id
       where r.target_type = 'post' and r.target_id = p_target_id and r.status = 'open'
         and rp.created_at < now() - interval '3 days') >= 5 then
    update public.posts set deleted_at = now() where id = p_target_id and deleted_at is null;
  end if;
end;
$$;
revoke all on function public.report_content(text, uuid, text) from public, anon, service_role;
grant execute on function public.report_content(text, uuid, text) to authenticated;

-- ── Feed (invoker: posts' RLS hides deleted and blocked posts) ────────────────
create function public.get_feed(
  p_tab text default 'everyone',
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20,
  p_author uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(f) order by f.created_at desc, f.id desc), '[]'::jsonb)
  from (
    select p.id, p.body, p.attachment, p.like_count, p.comment_count, p.created_at,
           p.author_id = (select auth.uid()) as mine,
           exists (select 1 from public.post_likes l
                   where l.post_id = p.id and l.user_id = (select auth.uid())) as liked,
           jsonb_build_object(
             'id', a.id, 'username', a.username, 'display_name', a.display_name,
             'avatar_base', ib.asset, 'outfit', io.asset, 'accessory', ia.asset,
             'background', ibg.asset, 'border', ibd.asset,
             'name_color', inc.asset, 'name_style', ins.asset) as author
    from public.posts p
    -- public_profiles, not profiles: profiles' RLS shows only your own row.
    join public.public_profiles a on a.id = p.author_id
    left join public.equipped_cosmetics e on e.user_id = a.id
    left join public.items ib on ib.id = e.avatar_base_id
    left join public.items io on io.id = e.outfit_id
    left join public.items ia on ia.id = e.accessory_id
    left join public.items ibg on ibg.id = e.background_id
    left join public.items ibd on ibd.id = e.border_id
    left join public.items inc on inc.id = e.name_color_id
    left join public.items ins on ins.id = e.name_style_id
    where (p_tab <> 'following' or p.author_id = (select auth.uid()) or exists (
             select 1 from public.follows fo
             where fo.follower_id = (select auth.uid()) and fo.followee_id = p.author_id))
      and (p_author is null or p.author_id = p_author)
      and (p_before_created is null
           or (p.created_at, p.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by p.created_at desc, p.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) f;
$$;
revoke all on function public.get_feed(text, timestamptz, uuid, int, uuid) from public, anon;
grant execute on function public.get_feed(text, timestamptz, uuid, int, uuid) to authenticated;

-- ── Public profile (definer: stats respect is_private; blocked = not found) ──
create function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  p public.profiles%rowtype;
  v_show boolean;
  v_today date;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select * into p from public.profiles
  where username = p_username::extensions.citext and onboarded_at is not null;
  if not found or public.is_blocked_between(v_me, p.id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  v_show := not p.is_private or p.id = v_me;
  v_today := (now() at time zone p.timezone)::date;
  return jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'bio', p.bio,
    'is_private', p.is_private, 'is_me', p.id = v_me,
    'level', case when v_show then public.level_for(p.lifetime_points) end,
    'current_streak', case when v_show then p.current_streak end,
    'longest_streak', case when v_show then p.longest_streak end,
    'followers', (select count(*) from public.follows f where f.followee_id = p.id),
    'following', (select count(*) from public.follows f where f.follower_id = p.id),
    'i_follow', exists (select 1 from public.follows f where f.follower_id = v_me and f.followee_id = p.id),
    'i_blocked', false,
    'today', case when v_show then v_today end,
    'heatmap', case when v_show then (
      select coalesce(jsonb_object_agg(d.local_date, d.completed_count), '{}'::jsonb)
      from public.daily_progress d
      where d.user_id = p.id and d.local_date > v_today - 7 * 12 - 7) end,
    'cosmetics', (
      select jsonb_build_object(
        'avatar_base', ib.asset, 'outfit', io.asset, 'accessory', ia.asset,
        'background', ibg.asset, 'border', ibd.asset,
        'name_color', inc.asset, 'name_style', ins.asset, 'title', it.name)
      from public.equipped_cosmetics e
      left join public.items ib on ib.id = e.avatar_base_id
      left join public.items io on io.id = e.outfit_id
      left join public.items ia on ia.id = e.accessory_id
      left join public.items ibg on ibg.id = e.background_id
      left join public.items ibd on ibd.id = e.border_id
      left join public.items inc on inc.id = e.name_color_id
      left join public.items ins on ins.id = e.name_style_id
      left join public.items it on it.id = e.title_id
      where e.user_id = p.id));
end;
$$;
revoke all on function public.get_public_profile(text) from public, anon, service_role;
grant execute on function public.get_public_profile(text) to authenticated;

-- ── Weekly leaderboard (plan §5: materialized, public fields, no private) ────
create materialized view public.leaderboard_weekly as
select p.id as user_id, p.username, p.display_name, sum(l.delta)::int as week_points
from public.points_ledger l
join public.profiles p on p.id = l.user_id
where l.reason in ('completion', 'streak_milestone', 'undo')
  and l.created_at >= date_trunc('week', now() at time zone 'UTC') at time zone 'UTC'
  and not p.is_private
  and p.onboarded_at is not null
group by p.id, p.username, p.display_name
having sum(l.delta) > 0;
create unique index leaderboard_weekly_user_idx on public.leaderboard_weekly (user_id);
create index leaderboard_weekly_points_idx on public.leaderboard_weekly (week_points desc);
-- Read only through get_leaderboard, which applies blocks and re-checks
-- privacy (a matview has no RLS; audit L1).
revoke all on public.leaderboard_weekly from anon, authenticated;

create function public.refresh_leaderboard()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view concurrently public.leaderboard_weekly;
$$;
revoke all on function public.refresh_leaderboard() from public, anon, authenticated;
grant execute on function public.refresh_leaderboard() to service_role;
select cron.schedule('questrix-leaderboard', '*/10 * * * *', 'select public.refresh_leaderboard()');

/**
 * Top 100 (global, or me + the people I follow), plus my rank. Ranks are
 * computed over the whole board so a friends rank is still the global one.
 */
create function public.get_leaderboard(p_scope text default 'global')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranked_all as (
    select lb.user_id, lb.username, lb.display_name, lb.week_points,
           rank() over (order by lb.week_points desc) as rank
    from public.leaderboard_weekly lb
    join public.profiles pr on pr.id = lb.user_id and not pr.is_private
  ), ranked as (
    select * from ranked_all r
    where not public.is_blocked_between(r.user_id, (select auth.uid()))
  ), scoped as (
    select * from ranked r
    where p_scope <> 'friends' or r.user_id = (select auth.uid()) or exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = r.user_id)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_to_json(t) order by t.rank, t.username)
                      from (select * from scoped order by rank, username limit 100) t), '[]'::jsonb),
    'me', (select row_to_json(m) from ranked m where m.user_id = (select auth.uid())));
$$;
revoke all on function public.get_leaderboard(text) from public, anon, service_role;
grant execute on function public.get_leaderboard(text) to authenticated;

-- ── Social proof (plan §8.2 rule 5): aggregated counts only ──────────────────
-- A template counts only when at least 2 mutual follows with public profiles
-- use it (audit M2): one-way follows would let a sock puppet isolate a
-- target's habits.
create function public.popular_templates_among_following()
returns table (template_key text, followers_using int)
language sql
stable
security definer
set search_path = ''
as $$
  select h.template_key, count(distinct h.user_id)::int
  from public.follows f
  join public.follows back on back.follower_id = f.followee_id and back.followee_id = f.follower_id
  join public.profiles pr on pr.id = f.followee_id and not pr.is_private
  join public.habits h on h.user_id = f.followee_id
  where f.follower_id = (select auth.uid())
    and h.template_key is not null and h.archived_at is null
  group by h.template_key
  having count(distinct h.user_id) >= 2;
$$;
revoke all on function public.popular_templates_among_following() from public, anon, service_role;
grant execute on function public.popular_templates_among_following() to authenticated;

-- ── Realtime: "new posts" toasts (RLS still applies to what's delivered) ─────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;

-- ── Blocked users for Settings (blocks are owner-only; usernames are public) ─
create function public.my_blocked_users()
returns table (user_id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, p.username::text
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;
revoke all on function public.my_blocked_users() from public, anon, service_role;
grant execute on function public.my_blocked_users() to authenticated;
