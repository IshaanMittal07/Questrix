-- Phase 3: habits — RLS, column privileges, checks, 20-active cap, RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- Fixed ids for habits we refer to later.
-- a1/a2: Alice's; b1: Bob's.
select pg_temp.as_postgres();
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Meditate 10 min', 'mind'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Workout', 'fitness'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Read 20 pages', 'learning');

-- ── Table setup ─────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.habits'::regclass),
  'RLS is enabled on habits');
select ok(not has_function_privilege('authenticated', 'public.habits_before_write()', 'execute'),
  'clients cannot call the trigger function');

-- ── Owner access ────────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.habits (title, category, days_of_week, reminder_times, template_key)
    values ('  Floss  ', 'self_care', '{3,1,1,5}', '{22:00:30,07:15,22:00}', 'floss')$$,
  'a user can create a habit');
select is((select user_id from public.habits where template_key = 'floss'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'user_id defaults to the signed-in user');
select is((select title from public.habits where template_key = 'floss'),
  'Floss', 'the title is trimmed');
select is((select days_of_week from public.habits where template_key = 'floss'),
  '{1,3,5}'::smallint[], 'days are sorted and de-duplicated');
select is((select reminder_times from public.habits where template_key = 'floss'),
  '{07:15,22:00}'::time[], 'reminder times are truncated to the minute, sorted and de-duplicated');
select is((select count(*)::int from public.habits), 3,
  'a user sees only their own habits');

select lives_ok(
  $$update public.habits set title = 'Meditate 15 min', target_per_day = 2
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'a user can edit their own habit');

-- ── Cross-user isolation ────────────────────────────────────────────────────
update public.habits set title = 'hacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select pg_temp.as_postgres();
select is((select title from public.habits where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'Read 20 pages', 'a user cannot edit another user''s habit');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into public.habits (user_id, title, category)
    values ('22222222-2222-2222-2222-222222222222', 'planted', 'mind')$$,
  '42501', null, 'a user cannot choose user_id (no column privilege)');

-- ── Column privileges ───────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.habits (title, category, archived_at) values ('x', 'mind', now())$$,
  '42501', null, 'clients cannot set archived_at on insert');
select throws_ok(
  $$update public.habits set archived_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null, 'clients cannot set archived_at directly');
select throws_ok(
  $$update public.habits set created_at = now() - interval '1 year'
    where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null, 'clients cannot backdate created_at');
select throws_ok(
  $$update public.habits set user_id = '22222222-2222-2222-2222-222222222222'
    where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null, 'clients cannot move a habit to another user');
select throws_ok(
  $$delete from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null, 'clients cannot delete habits (archive instead)');

select pg_temp.as_anon();
select throws_ok($$select count(*) from public.habits$$, '42501', null,
  'anon cannot read habits');
select throws_ok($$select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon cannot call archive_habit');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

-- ── Check constraints ───────────────────────────────────────────────────────
select throws_ok($$insert into public.habits (title, category) values ('   ', 'mind')$$,
  '23514', null, 'a blank title is rejected');
select throws_ok($$insert into public.habits (title, category) values (repeat('x', 61), 'mind')$$,
  '23514', null, 'a title over 60 characters is rejected');
select lives_ok($$insert into public.habits (title, category, template_key)
    values (repeat('x', 60), 'mind', 'len60')$$,
  'a 60-character title is accepted');
select throws_ok($$insert into public.habits (title, category, description)
    values ('x', 'mind', repeat('d', 281))$$,
  '23514', null, 'a description over 280 characters is rejected');
select throws_ok($$insert into public.habits (title, category, days_of_week) values ('x', 'mind', '{}')$$,
  '23514', null, 'a habit must be scheduled on at least one day');
select throws_ok($$insert into public.habits (title, category, days_of_week) values ('x', 'mind', '{7}')$$,
  '23514', null, 'days outside 0..6 are rejected');
select throws_ok($$insert into public.habits (title, category, days_of_week) values ('x', 'mind', '{1,null}')$$,
  '23514', null, 'null days are rejected');
select throws_ok($$insert into public.habits (title, category, target_per_day) values ('x', 'mind', 0)$$,
  '23514', null, 'target_per_day below 1 is rejected');
select throws_ok($$insert into public.habits (title, category, target_per_day) values ('x', 'mind', 6)$$,
  '23514', null, 'target_per_day above 5 is rejected');
select throws_ok($$insert into public.habits (title, category, reminder_times)
    values ('x', 'mind', '{06:00,07:00,08:00,09:00,10:00,11:00}')$$,
  '23514', null, 'more than 5 reminder times are rejected');
select throws_ok($$insert into public.habits (title, category, color) values ('x', 'mind', '#ff0000')$$,
  '23514', null, 'colours must be a design token name');
select throws_ok($$insert into public.habits (title, category, template_key) values ('x', 'mind', 'Bad Key!')$$,
  '23514', null, 'template keys must be lowercase slugs');

-- ── 20-active cap ───────────────────────────────────────────────────────────
-- Alice has 4 active habits (a1, a2, floss, len60). Fill up to 20.
select lives_ok(
  $$insert into public.habits (title, category, template_key)
    select 'Habit ' || g, 'other', 'cap_' || g from generate_series(1, 16) as g$$,
  'a user can have 20 active habits');
select is((select count(*)::int from public.habits where archived_at is null), 20,
  'Alice now has exactly 20 active habits');
select throws_ok(
  $$insert into public.habits (title, category) values ('one too many', 'mind')$$,
  '23514', 'You can have at most 20 active habits', 'the 21st active habit is rejected');

-- ── archive / unarchive ─────────────────────────────────────────────────────
select lives_ok($$select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a user can archive their own habit');
select isnt((select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null, 'archive_habit sets archived_at');

create temp table archived_at_before as
  select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000002');
select is((select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  (select archived_at from archived_at_before), 'archiving twice keeps the first archived_at');

select lives_ok($$insert into public.habits (title, category, template_key) values ('slot freed', 'mind', 'freed')$$,
  'archiving frees a slot under the cap');
select throws_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  '23514', 'You can have at most 20 active habits', 'unarchiving is blocked at the cap');

select public.archive_habit(id) from public.habits where template_key = 'freed';
select lives_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a user can unarchive below the cap');
select is((select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null, 'unarchive_habit clears archived_at');
select is((select sort_order from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  (select max(sort_order) from public.habits where archived_at is null),
  'an unarchived habit goes to the end of the list');

select throws_ok($$select public.archive_habit('bbbbbbbb-0000-0000-0000-000000000001')$$,
  'P0002', 'Habit not found', 'a user cannot archive another user''s habit');
select throws_ok($$select public.unarchive_habit('bbbbbbbb-0000-0000-0000-000000000001')$$,
  'P0002', 'Habit not found', 'a user cannot unarchive another user''s habit');

-- ── reorder_habits ──────────────────────────────────────────────────────────
create temp table alice_order as
  select array_agg(id order by sort_order desc, created_at desc, id desc) as ids
  from public.habits where archived_at is null;
select lives_ok($$select public.reorder_habits((select ids from alice_order))$$,
  'a user can reorder all their active habits');
select is(
  (select array_agg(id order by sort_order) from public.habits where archived_at is null),
  (select ids from alice_order), 'sort_order follows the given order');
select is(
  (select array_agg(sort_order order by sort_order) from public.habits where archived_at is null),
  (select array_agg(g) from generate_series(0, 19) as g), 'positions are 0-based and contiguous');

select throws_ok($$select public.reorder_habits((select ids[2:] from alice_order))$$,
  '22023', null, 'a reorder that leaves out a habit is rejected');
select throws_ok($$select public.reorder_habits((select ids[2:] || ids[2] from alice_order))$$,
  '22023', null, 'a reorder with a duplicate is rejected');
select throws_ok(
  $$select public.reorder_habits((select ids[2:] || '{bbbbbbbb-0000-0000-0000-000000000001}'::uuid[] from alice_order))$$,
  '22023', null, 'a reorder including another user''s habit is rejected');
select throws_ok(
  $$select public.reorder_habits((select ids[2:] || array(select id from public.habits where template_key = 'freed') from alice_order))$$,
  '22023', null, 'a reorder including an archived habit is rejected');

-- ── Account deletion cascades ───────────────────────────────────────────────
select pg_temp.as_postgres();
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.habits
           where user_id = '22222222-2222-2222-2222-222222222222'), 0,
  'deleting an account deletes its habits');

select * from finish();
rollback;
