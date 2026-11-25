-- export_my_data: the rest of the caller's own data (Phase 8 review nit).
-- Adds daily progress, streak milestones, equipped items, likes given and
-- users blocked. Still only auth.uid()'s rows; other people's data (their
-- comments on my posts, who follows me) stays out.
create or replace function public.export_my_data()
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
    'daily_progress', (select coalesce(jsonb_agg(jsonb_build_object(
        'local_date', d.local_date, 'completed_count', d.completed_count,
        'counted_for_streak', d.counted_for_streak) order by d.local_date), '[]')
      from public.daily_progress d where d.user_id = (select auth.uid())),
    'streak_milestones', (select coalesce(jsonb_agg(jsonb_build_object(
        'milestone', m.milestone, 'points', m.points, 'awarded_on', m.awarded_on) order by m.awarded_on), '[]')
      from public.streak_milestones_awarded m where m.user_id = (select auth.uid())),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
        'delta', l.delta, 'reason', l.reason, 'created_at', l.created_at) order by l.id), '[]')
      from public.points_ledger l where l.user_id = (select auth.uid())),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('slug', i.slug, 'acquired_at', ui.acquired_at)), '[]')
      from public.user_items ui join public.items i on i.id = ui.item_id where ui.user_id = (select auth.uid())),
    'equipped', (select jsonb_strip_nulls(jsonb_build_object(
        'avatar_base', (select slug from public.items where id = e.avatar_base_id),
        'outfit', (select slug from public.items where id = e.outfit_id),
        'accessory', (select slug from public.items where id = e.accessory_id),
        'name_color', (select slug from public.items where id = e.name_color_id),
        'name_style', (select slug from public.items where id = e.name_style_id),
        'title', (select slug from public.items where id = e.title_id),
        'background', (select slug from public.items where id = e.background_id),
        'border', (select slug from public.items where id = e.border_id)))
      from public.equipped_cosmetics e where e.user_id = (select auth.uid())),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object(
        'body', p.body, 'attachment', p.attachment, 'created_at', p.created_at, 'deleted_at', p.deleted_at)
        order by p.created_at), '[]')
      from public.posts p where p.author_id = (select auth.uid())),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object(
        'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at, 'deleted_at', c.deleted_at)
        order by c.created_at), '[]')
      from public.comments c where c.author_id = (select auth.uid())),
    'likes', (select coalesce(jsonb_agg(jsonb_build_object('post_id', l.post_id, 'created_at', l.created_at)
        order by l.created_at), '[]')
      from public.post_likes l where l.user_id = (select auth.uid())),
    'following', (select coalesce(jsonb_agg(pr.username), '[]')
      from public.follows f join public.profiles pr on pr.id = f.followee_id
      where f.follower_id = (select auth.uid())),
    'blocked', (select coalesce(jsonb_agg(pr.username), '[]')
      from public.blocks b join public.profiles pr on pr.id = b.blocked_id
      where b.blocker_id = (select auth.uid())))
  where (select auth.uid()) is not null;
$$;
