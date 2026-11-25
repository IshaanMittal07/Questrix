-- Phase 8: engine rate limit (#79), admin_adjust_points (#83), data export,
-- and an RLS audit sweep over every public table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, email) values
  ('80000001-0000-0000-0000-000000000000', 'hard1@example.com'),
  ('80000002-0000-0000-0000-000000000000', 'hard2@example.com');
update public.profiles set onboarded_at = now(), username = 'hard_' || substr(id::text, 8, 1)
where id::text like '8000000%';

-- ── RLS audit: every public table has RLS on ─────────────────────────────────
select is((select array_agg(c.relname::text order by c.relname) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null, 'every public table has RLS enabled');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  null, 'every SECURITY DEFINER function pins search_path');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon can execute no SECURITY DEFINER function');

-- ── #83: admin_adjust_points ─────────────────────────────────────────────────
select ok(not has_table_privilege('service_role', 'public.points_ledger', 'insert'), 'service_role can''t write the ledger directly');
select ok(has_function_privilege('service_role', 'public.admin_adjust_points(uuid, integer, text)', 'execute'), 'service_role adjusts through the RPC');
select ok(not has_function_privilege('authenticated', 'public.admin_adjust_points(uuid, integer, text)', 'execute'), 'users can''t');
select is(public.admin_adjust_points('80000001-0000-0000-0000-000000000000', 500, 'test'), 500, 'it returns the new balance');
select is((select sum(delta)::int from public.points_ledger where user_id = '80000001-0000-0000-0000-000000000000'), 500,
  'and the ledger moved with it');
select throws_ok($$select public.admin_adjust_points('80000001-0000-0000-0000-000000000000', 0)$$, '22023', null, 'a zero delta is refused');
select throws_ok($$select public.admin_adjust_points('80000001-0000-0000-0000-000000000000', -501)$$, '23514', null,
  'it can''t push the balance below zero');

-- ── #79: completion/undo rate limit for signed-in requests ───────────────────
select pg_temp.as_user('80000002-0000-0000-0000-000000000000');
select pg_temp.as_postgres();
-- 30 completion/undo rows in the last minute, as if from a loop.
insert into public.points_ledger (user_id, delta, reason, ref_id)
select '80000002-0000-0000-0000-000000000000', 10, 'completion', gen_random_uuid() from generate_series(1, 30);
select lives_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('80000002-0000-0000-0000-000000000000', 10, 'completion', gen_random_uuid())$$,
  'internal callers (no JWT) aren''t limited');
select set_config('request.jwt.claims', '{"sub":"80000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
select throws_ok($$insert into public.points_ledger (user_id, delta, reason, ref_id)
  values ('80000002-0000-0000-0000-000000000000', 10, 'completion', gen_random_uuid())$$,
  'QX109', null, 'a signed-in request past 30 a minute is refused');
select lives_ok($$insert into public.points_ledger (user_id, delta, reason)
  values ('80000002-0000-0000-0000-000000000000', 10, 'admin_adjust')$$,
  'other ledger reasons aren''t limited');
select pg_temp.as_postgres();

-- ── Data export ──────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.export_my_data()', 'execute'), 'anon can''t export');
select pg_temp.as_user('80000001-0000-0000-0000-000000000000');
select is(public.export_my_data() -> 'profile' ->> 'username', 'hard_1', 'the export holds my profile');
select is(jsonb_array_length(public.export_my_data() -> 'ledger'), 1, 'and only my ledger');
select ok((select bool_and(public.export_my_data() ? k) from unnest(array['daily_progress', 'streak_milestones',
             'equipped', 'likes', 'blocked']) k),
  'the export also covers daily progress, milestones, equipped items, likes and blocks');
select is(public.export_my_data() -> 'equipped' ->> 'outfit', 'starter-tee', 'with equipped items by slug');
select pg_temp.as_postgres();
select is(public.export_my_data(), null, 'with no user there''s nothing to export');

-- ── Push subscription churn limit (#79, RUNBOOK §5) ─────────────────────────
select pg_temp.as_user('80000002-0000-0000-0000-000000000000');
select lives_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/mine',
    'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY') from generate_series(1, 30) g$q$,
  're-saving a device you own (every Settings visit) is never limited');
-- Churn: 20 new endpoints, each removed again (stays under the 10-device cap).
select lives_ok($q$do $d$ begin for g in 1..19 loop
    perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/churn' || g,
      'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY');
    delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/churn' || g;
  end loop; end $d$$q$, 'twenty new devices in an hour are fine (the first save counted too)');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/churn-next',
    'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY')$q$,
  'QX001', 'Too many notification sign-ups', 'the 21st new endpoint in an hour is refused');
select pg_temp.as_postgres();

-- ── Account deletion leaves nothing behind (audit L5) ───────────────────────
insert into public.habits (user_id, title, category) values ('80000001-0000-0000-0000-000000000000', 'H', 'mind');
insert into public.user_items (user_id, item_id) select '80000001-0000-0000-0000-000000000000', id from public.items where slug = 'neon-hoodie';
insert into public.posts (id, author_id, body) values ('8a000000-0000-0000-0000-000000000001', '80000001-0000-0000-0000-000000000000', 'bye');
insert into public.comments (post_id, author_id, body) values ('8a000000-0000-0000-0000-000000000001', '80000002-0000-0000-0000-000000000000', 'hi');
insert into public.post_likes (post_id, user_id) values ('8a000000-0000-0000-0000-000000000001', '80000002-0000-0000-0000-000000000000');
insert into public.follows (follower_id, followee_id) values ('80000002-0000-0000-0000-000000000000', '80000001-0000-0000-0000-000000000000');
insert into public.blocks (blocker_id, blocked_id) values ('80000001-0000-0000-0000-000000000000', '80000002-0000-0000-0000-000000000000');
delete from auth.users where id = '80000001-0000-0000-0000-000000000000';
set constraints all immediate;
select is((
  (select count(*) from public.profiles where id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.habits where user_id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.points_ledger where user_id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.user_items where user_id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.equipped_cosmetics where user_id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.posts where author_id = '80000001-0000-0000-0000-000000000000')
  + (select count(*) from public.comments where post_id = '8a000000-0000-0000-0000-000000000001')
  + (select count(*) from public.post_likes where post_id = '8a000000-0000-0000-0000-000000000001')
  + (select count(*) from public.follows where '80000001-0000-0000-0000-000000000000' in (follower_id, followee_id))
  + (select count(*) from public.blocks where '80000001-0000-0000-0000-000000000000' in (blocker_id, blocked_id))
  + (select count(*) from public.notifications_inbox where user_id = '80000001-0000-0000-0000-000000000000'))::int,
  0, 'deleting the account removes its profile, habits, ledger, items, posts (with their likes and comments), follows, blocks and inbox');

select * from finish();
rollback;
