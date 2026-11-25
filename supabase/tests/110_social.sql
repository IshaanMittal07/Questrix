-- Phase 7: social tables, RPCs and policies (plan §12 Phase 7 acceptance).
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

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
create temp table ids (n text primary key, id uuid);
grant all on ids to authenticated;
create function pg_temp.keep(n text, id uuid) returns uuid language sql as $$
  insert into ids values (n, id) on conflict (n) do update set id = excluded.id returning id $$;
create function pg_temp.id(p_n text) returns uuid language sql as $$ select id from ids where n = p_n $$;

-- Users a, b, c, d, e, f (onboarded), g (not onboarded). Users 1-6 are 7000000k.
insert into auth.users (id, email)
select ('7000000' || g || '-0000-0000-0000-000000000000')::uuid, 'soc' || g || '@example.com'
from generate_series(1, 7) as g;
update public.profiles set onboarded_at = now(), username = 'soc_' || substr(id::text, 8, 1)
where id::text like '7000000%' and id::text not like '70000007%';
-- a = 1, b = 2, c = 3 (private), d..f = 4..6 report helpers.
update public.profiles set is_private = true, current_streak = 9 where id = '70000003-0000-0000-0000-000000000000';

-- ── Privileges ────────────────────────────────────────────────────────────────
select ok(not has_table_privilege('authenticated', 'public.posts', 'insert'), 'no direct post inserts');
select ok(not has_table_privilege('authenticated', 'public.posts', 'update'), 'no direct post updates (counters, attachment)');
select ok(not has_table_privilege('authenticated', 'public.comments', 'insert'), 'no direct comment inserts');
select ok(not has_table_privilege('authenticated', 'public.reports', 'insert'), 'no direct report inserts');
select ok(not has_table_privilege('authenticated', 'public.notifications_inbox', 'insert'), 'no inbox inserts');
select ok(not has_column_privilege('authenticated', 'public.notifications_inbox', 'payload', 'update'), 'inbox payload is read-only');
select ok(not has_table_privilege('anon', 'public.leaderboard_weekly', 'select'), 'anon can''t read the leaderboard');
select ok(not has_function_privilege('authenticated', 'public.notify(uuid, uuid, text, jsonb)', 'execute'), 'notify is internal');
select ok(not has_function_privilege('authenticated', 'public.refresh_leaderboard()', 'execute'), 'refresh is internal');
select ok(not has_function_privilege('anon', 'public.create_post(text, boolean)', 'execute'), 'anon can''t post');

-- ── Posting ───────────────────────────────────────────────────────────────────
select pg_temp.as_user('70000007-0000-0000-0000-000000000000');
select throws_ok($$select public.create_post('hi')$$, 'QX107', null, 'not onboarded can''t post');
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select throws_ok($$select public.create_post('   ')$$, '22023', null, 'a blank post is refused');
select throws_ok($$select public.create_post(repeat('x', 1001))$$, '22023', null, 'over 1000 characters is refused');
select throws_ok($$select public.create_post('what the fuck')$$, 'QX302', null, 'blocked words are refused');
select lives_ok($$select pg_temp.keep('pa', public.create_post('  <script>alert(1)</script> day 1  ', true))$$, 'a post with a summary');
select pg_temp.as_postgres();
select is((select body from public.posts where id = pg_temp.id('pa')), '<script>alert(1)</script> day 1', 'stored trimmed, as text');
select is((select attachment ->> 'type' from public.posts where id = pg_temp.id('pa')), 'weekly_summary', 'with a server-built summary');
select is((select (attachment ->> 'streak')::int from public.posts where id = pg_temp.id('pa')), 0, 'from real profile data');

-- Rate limit: 10 per hour.
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select lives_ok($$select public.create_post('post ' || g) from generate_series(2, 10) g$$, 'ten posts in an hour are fine');
select throws_ok($$select public.create_post('eleventh')$$, 'QX301', null, 'the eleventh in an hour is refused');

-- ── Visibility, blocks both ways ─────────────────────────────────────────────
select pg_temp.as_user('70000002-0000-0000-0000-000000000000');
select is((select count(*)::int from public.posts where author_id = '70000001-0000-0000-0000-000000000000'), 10, 'b sees a''s posts');
select is(jsonb_array_length(public.get_feed('everyone', p_author => '70000001-0000-0000-0000-000000000000')), 10, 'b''s Everyone feed has them');
select is(jsonb_array_length(public.get_feed('following')), 0, 'b''s Following feed is empty');
insert into public.follows (follower_id, followee_id) values ('70000002-0000-0000-0000-000000000000', '70000001-0000-0000-0000-000000000000');
select is(jsonb_array_length(public.get_feed('following')), 10, 'after following a, it has them');
select is(jsonb_array_length(public.get_feed('everyone', null, null, 4, '70000001-0000-0000-0000-000000000000')), 4, 'a page of 4');
-- Scoped to a's posts: other tests' posts may share the local database.
select is(jsonb_array_length(public.get_feed('everyone',
  (public.get_feed('everyone', null, null, 4, '70000001-0000-0000-0000-000000000000') -> 3 ->> 'created_at')::timestamptz,
  (public.get_feed('everyone', null, null, 4, '70000001-0000-0000-0000-000000000000') -> 3 ->> 'id')::uuid, 50,
  '70000001-0000-0000-0000-000000000000')), 6, 'the keyset cursor returns the other 6');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('70000001-0000-0000-0000-000000000000', '70000002-0000-0000-0000-000000000000')$$,
  '42501', null, 'b can''t make a follow a');

select pg_temp.as_postgres();
select is((select count(*)::int from public.notifications_inbox where user_id = '70000001-0000-0000-0000-000000000000' and type = 'follow'), 1, 'a gets a follow notification');

-- a blocks b: follows go, and neither sees the other.
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
insert into public.blocks (blocker_id, blocked_id) values ('70000001-0000-0000-0000-000000000000', '70000002-0000-0000-0000-000000000000');
select pg_temp.as_user('70000002-0000-0000-0000-000000000000');
select is((select count(*)::int from public.posts where author_id = '70000001-0000-0000-0000-000000000000'), 0, 'blocked: b no longer sees a''s posts');
select is((select count(*)::int from public.follows where follower_id = '70000002-0000-0000-0000-000000000000'), 0, 'blocking removed b''s follow');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('70000002-0000-0000-0000-000000000000', '70000001-0000-0000-0000-000000000000')$$,
  'QX303', null, 'b can''t follow a while blocked');
select throws_ok($$select public.create_comment(pg_temp.id('pa'), 'hey')$$, 'P0002', null, 'b can''t comment on a''s post');
select throws_ok($$insert into public.post_likes (post_id, user_id) values (pg_temp.id('pa'), '70000002-0000-0000-0000-000000000000')$$,
  '42501', null, 'b can''t like a''s post');
select throws_ok($$select public.get_public_profile('soc_1')$$, 'P0002', null, 'b can''t open a''s profile');
select lives_ok($$select public.create_post('b here')$$, 'b posts');
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select is((select count(*)::int from public.posts where author_id = '70000002-0000-0000-0000-000000000000'), 0, 'the other way too: a doesn''t see b''s post');
select is((select count(*)::int from public.blocks), 1, 'a sees their own block');
delete from public.blocks where blocked_id = '70000002-0000-0000-0000-000000000000';

-- ── Likes and comments keep their counters ───────────────────────────────────
select pg_temp.as_user('70000002-0000-0000-0000-000000000000');
insert into public.post_likes (post_id, user_id) values (pg_temp.id('pa'), '70000002-0000-0000-0000-000000000000');
select pg_temp.as_user('70000004-0000-0000-0000-000000000000');
insert into public.post_likes (post_id, user_id) values (pg_temp.id('pa'), '70000004-0000-0000-0000-000000000000');
delete from public.post_likes where post_id = pg_temp.id('pa');
select pg_temp.as_postgres();
select is((select like_count from public.posts where id = pg_temp.id('pa')), 1, 'like, like, unlike = 1');
select is((select count(*)::int from public.post_likes where post_id = pg_temp.id('pa')), 1, 'and matches the rows');
select pg_temp.as_user('70000004-0000-0000-0000-000000000000');
select pg_temp.keep('c1', public.create_comment(pg_temp.id('pa'), 'nice'));
select public.create_comment(pg_temp.id('pa'), 'again');
select public.delete_comment(pg_temp.id('c1'));
select throws_ok($$select public.delete_comment(pg_temp.id('c1'))$$, 'P0002', null, 'a deleted comment is gone');
select pg_temp.as_user('70000002-0000-0000-0000-000000000000');
select throws_ok($$select public.delete_post(pg_temp.id('pa'))$$, 'P0002', null, 'b can''t delete a''s post');
select pg_temp.as_postgres();
select is((select comment_count from public.posts where id = pg_temp.id('pa')), 1, 'comment, comment, delete = 1');
select is((select count(*)::int from public.notifications_inbox where user_id = '70000001-0000-0000-0000-000000000000' and type in ('like', 'comment')), 4,
  'a is notified of 2 likes and 2 comments');

-- ── Private profile ───────────────────────────────────────────────────────────
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select is(public.get_public_profile('soc_3') -> 'current_streak', 'null'::jsonb, 'a private profile hides its streak');
select is(public.get_public_profile('soc_3') -> 'heatmap', 'null'::jsonb, 'and its heatmap');
select is(public.get_public_profile('soc_3') ->> 'username', 'soc_3', 'but shows the username');
select pg_temp.as_user('70000003-0000-0000-0000-000000000000');
select is((public.get_public_profile('soc_3') ->> 'current_streak')::int, 9, 'the owner still sees it');

-- ── Reports: auto-hide at 5 distinct reporters ───────────────────────────────
select pg_temp.as_postgres();
update public.profiles set onboarded_at = now(), username = 'soc_7' where id = '70000007-0000-0000-0000-000000000000';
select pg_temp.as_user('70000002-0000-0000-0000-000000000000');
select public.report_content('post', pg_temp.id('pa'), 'spam');
select public.report_content('post', pg_temp.id('pa'), 'spam again'); -- duplicate, ignored
select pg_temp.as_user('70000003-0000-0000-0000-000000000000');
select public.report_content('post', pg_temp.id('pa'));
select pg_temp.as_user('70000004-0000-0000-0000-000000000000');
select public.report_content('post', pg_temp.id('pa'));
select pg_temp.as_user('70000005-0000-0000-0000-000000000000');
select public.report_content('post', pg_temp.id('pa'));
select pg_temp.as_postgres();
select ok((select deleted_at is null from public.posts where id = pg_temp.id('pa')), 'four reporters don''t hide it');
select pg_temp.as_user('70000006-0000-0000-0000-000000000000');
select public.report_content('post', pg_temp.id('pa'));
select pg_temp.as_postgres();
select ok((select deleted_at is not null from public.posts where id = pg_temp.id('pa')), 'the fifth distinct reporter hides it');
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select throws_ok($$select public.report_content('user', '70000001-0000-0000-0000-000000000000')$$, 'P0002', null, 'you can''t report yourself');

-- ── Leaderboard: no private profiles ──────────────────────────────────────────
select pg_temp.as_postgres();
insert into public.points_ledger (user_id, delta, reason, ref_id)
select ('7000000' || g || '-0000-0000-0000-000000000000')::uuid, 100 * g, 'completion', gen_random_uuid()
from generate_series(1, 3) g;
refresh materialized view public.leaderboard_weekly;
select pg_temp.as_user('70000001-0000-0000-0000-000000000000');
select is((select count(*)::int from public.leaderboard_weekly where user_id = '70000003-0000-0000-0000-000000000000'), 0,
  'the private user is left off the leaderboard');
select is((public.get_leaderboard('global') -> 'me' ->> 'rank')::int, 2, 'a is ranked #2 behind b');

select * from finish();
rollback;
