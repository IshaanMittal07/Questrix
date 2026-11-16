-- Phase 3: habits — RLS, column privileges, checks, 20-active cap, RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(113);

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
-- Authenticated role but no `sub` claim, so auth.uid() is null.
create function pg_temp.as_no_sub() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

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
select function_privs_are('public', 'archive_habit', array['uuid'], 'anon', array[]::text[],
  'anon cannot execute archive_habit');
select function_privs_are('public', 'unarchive_habit', array['uuid'], 'anon', array[]::text[],
  'anon cannot execute unarchive_habit');
select ok(not has_function_privilege('authenticated', 'public.habits_lock(uuid)', 'execute'),
  'clients cannot take the habits lock directly');
select ok(not has_function_privilege('service_role', 'public.habits_lock(uuid)', 'execute'),
  'the habits lock is internal to the owner''s functions');
select function_privs_are('public', 'habits_before_write', array[]::text[], 'service_role', array[]::text[],
  'service_role has no EXECUTE on the trigger function (triggers fire anyway)');
select function_privs_are('public', 'habits_clean_text', array['text'], 'anon', array[]::text[],
  'anon cannot call habits_clean_text');
select function_privs_are('public', 'habits_clean_text', array['text'], 'authenticated', array[]::text[],
  'authenticated cannot call habits_clean_text');
select function_privs_are('public', 'habits_clean_text', array['text'], 'service_role', array[]::text[],
  'service_role cannot call habits_clean_text directly');
select has_index('public', 'habits', 'habits_user_active_idx', array['user_id', 'sort_order'],
  'active habits are indexed by user and position');
select has_index('public', 'habits', 'habits_user_idx', array['user_id'],
  'all habits are indexed by user');
select has_index('public', 'habits', 'habits_id_user_unique', array['id', 'user_id'],
  '(id, user_id) is unique for Phase 4 composite foreign keys');
select function_privs_are('public', 'reorder_habits', array['uuid[]'], 'anon', array[]::text[],
  'anon cannot execute reorder_habits');
select function_privs_are('public', 'archive_habit', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can execute archive_habit');
select function_privs_are('public', 'unarchive_habit', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can execute unarchive_habit');
select function_privs_are('public', 'reorder_habits', array['uuid[]'], 'authenticated', array['EXECUTE'],
  'authenticated can execute reorder_habits');

-- ── Owner access ────────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.habits (title, category, days_of_week, reminder_times, template_key)
    values (E'\t Floss \n', 'self_care', '{3,1,1,5}', '{22:00:30,07:15,22:00}', 'floss')$$,
  'a user can create a habit');
select is((select user_id from public.habits where template_key = 'floss'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'user_id defaults to the signed-in user');
select is((select title from public.habits where template_key = 'floss'),
  'Floss', 'the title is trimmed');
select is((select sort_order from public.habits where template_key = 'floss'), 2,
  'a new habit goes to the end of the list (after a1 = 0, a2 = 1)');
select throws_ok(
  $$insert into public.habits (title, category, sort_order) values ('x', 'mind', 0)$$,
  '42501', null, 'clients cannot choose sort_order on insert');
select is((select days_of_week from public.habits where template_key = 'floss'),
  '{1,3,5}'::smallint[], 'days are sorted and de-duplicated');
select is((select reminder_times from public.habits where template_key = 'floss'),
  '{07:15,22:00}'::time[], 'reminder times are truncated to the minute, sorted and de-duplicated');
select is((select difficulty::text from public.habits where template_key = 'floss'),
  'medium', 'difficulty defaults to medium');
select is((select reminders_enabled from public.habits where template_key = 'floss'),
  true, 'reminders_enabled defaults to true');
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

-- The update policy's WITH CHECK is defence in depth behind the column grants:
-- grant update (user_id) for this test only and check RLS still blocks the move.
select pg_temp.as_postgres();
grant update (user_id) on public.habits to authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$update public.habits set user_id = '22222222-2222-2222-2222-222222222222'
    where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', 'new row violates row-level security policy for table "habits"',
  'the update policy''s WITH CHECK blocks moving a habit to another user');
select pg_temp.as_postgres();
revoke update (user_id) on public.habits from authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select pg_temp.as_anon();
select throws_ok($$select count(*) from public.habits$$, '42501', null,
  'anon cannot read habits');
select throws_ok($$select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon cannot call archive_habit');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

-- ── Check constraints ───────────────────────────────────────────────────────
select throws_ok($$insert into public.habits (title, category) values ('   ', 'mind')$$,
  '23514', null, 'a blank title is rejected');
select throws_ok($$insert into public.habits (title, category) values (E'\t\n ', 'mind')$$,
  '23514', null, 'a title of only tabs and newlines is rejected');
select throws_ok($$insert into public.habits (title, category, days_of_week)
    values ('x', 'mind', '{{1,2},{3,4}}')$$,
  '23514', 'days_of_week and reminder_times must be flat lists',
  'nested day arrays are rejected, not flattened');
select throws_ok($$insert into public.habits (title, category, reminder_times)
    values ('x', 'mind', '{{07:00,08:00}}')$$,
  '23514', 'days_of_week and reminder_times must be flat lists',
  'nested reminder-time arrays are rejected, not flattened');
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
update public.habits set icon = '  ', description = E' \n' where template_key = 'floss';
select is((select icon is null and description is null from public.habits where template_key = 'floss'),
  true, 'blank icons and descriptions are stored as null');
update public.habits set title = U&'\00A0\200BFlo\2066ss\2069\202E\00AD\00A0' where template_key = 'floss';
select is((select title from public.habits where template_key = 'floss'), 'Floss',
  'zero-width, bidi (incl. isolates), soft-hyphen and no-break characters are stripped from titles');
select throws_ok($$insert into public.habits (title, category) values (U&'\200B\2067\FEFF', 'mind')$$,
  '23514', null, 'a title of only invisible characters is rejected');
update public.habits set description = U&'\200B\2066', icon = E'\n' where template_key = 'floss';
select is((select description is null and icon is null from public.habits where template_key = 'floss'),
  true, 'descriptions and icons get the same invisible-character cleaning');
update public.habits set icon = U&'\+01F9D8\200D\2640\FE0F' where template_key = 'floss';
select is((select icon from public.habits where template_key = 'floss'), U&'\+01F9D8\200D\2640\FE0F',
  'a ZWJ emoji icon is kept intact');
update public.habits set title = U&'\200D\0645\06CC\200C\062E\0648\0627\0647\0645\200C' where template_key = 'floss';
select is((select title from public.habits where template_key = 'floss'), U&'\0645\06CC\200C\062E\0648\0627\0647\0645',
  'ZWNJ inside a Persian title is kept; joiners at the ends are trimmed');
update public.habits set title = 'Floss' where template_key = 'floss';
select throws_ok($$insert into public.habits (title, category) values (U&'\200D\200C', 'mind')$$,
  '23514', null, 'a title of only joiners is rejected');
select throws_ok($$insert into public.habits (title, category) values (E'a\nb', 'mind')$$,
  '23514', null, 'control characters inside a title are rejected');
select throws_ok($$insert into public.habits (title, category, reminder_times) values ('x', 'mind', '{24:00}')$$,
  '23514', null, '24:00 is rejected rather than wrapped to midnight');
select throws_ok($$insert into public.habits (title, category, reminder_times) values ('x', 'mind', null)$$,
  '23502', null, 'a null reminder_times list is a NOT NULL error, not silently emptied');
select throws_ok($$update public.habits set sort_order = 10000 where template_key = 'floss'$$,
  '42501', null, 'clients cannot set sort_order directly (use reorder_habits)');
select pg_temp.as_postgres();
select throws_ok($$update public.habits set sort_order = 10001 where template_key = 'floss'$$,
  '23514', null, 'sort_order above 10000 is rejected');
select throws_ok($$update public.habits set sort_order = -1 where template_key = 'floss'$$,
  '23514', null, 'negative sort_order is rejected');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select throws_ok($$insert into public.habits (title, category, icon) values ('x', 'mind', repeat('i', 33))$$,
  '23514', null, 'an icon over 32 characters is rejected');

-- ── 20-active cap ───────────────────────────────────────────────────────────
-- Alice has 4 active habits (a1, a2, floss, len60). Fill up to 20.
select throws_ok(
  $$insert into public.habits (title, category)
    select 'Bulk ' || g, 'other' from generate_series(1, 17) as g$$,
  '23514', 'You can have at most 20 active habits',
  'one multi-row insert that crosses the cap is rejected as a whole');
select lives_ok(
  $$insert into public.habits (title, category, template_key)
    select 'Habit ' || g, 'other', 'cap_' || g from generate_series(1, 16) as g$$,
  'a user can have 20 active habits');
select is((select count(*)::int from public.habits where archived_at is null), 20,
  'Alice now has exactly 20 active habits');
select throws_ok(
  $$insert into public.habits (title, category) values ('one too many', 'mind')$$,
  '23514', 'You can have at most 20 active habits', 'the 21st active habit is rejected');
select lives_ok(
  $$update public.habits set title = 'Meditate 20 min'
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'editing an active habit at the cap is not blocked by the cap');

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

-- Alice is back at 20 active with a2 archived.
select lives_ok(
  $$update public.habits set title = 'Workout (old)', target_per_day = 3
    where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'an archived habit can be edited at the cap');
select isnt((select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null, 'editing an archived habit leaves it archived');

create temp table a1_sort_before as
  select sort_order from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select lives_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'unarchiving an already-active habit at the cap is a no-op, not a cap error');
select is((select sort_order from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (select sort_order from a1_sort_before), 'unarchiving an active habit keeps its position');
select throws_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  '23514', 'You can have at most 20 active habits', 'unarchiving is blocked at the cap');

select public.archive_habit(id) from public.habits where template_key = 'freed';
select lives_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a user can unarchive below the cap');
select is((select archived_at from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null, 'unarchive_habit clears archived_at');
select is((select sort_order from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  (select max(sort_order) + 1 from public.habits
   where archived_at is null and id <> 'aaaaaaaa-0000-0000-0000-000000000002'),
  'an unarchived habit goes after every other active habit');

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
select throws_ok($$select public.reorder_habits(null)$$,
  '22023', null, 'a null reorder is rejected');
select throws_ok($$select public.reorder_habits('{}'::uuid[])$$,
  '22023', null, 'an empty reorder is rejected when there are active habits');
select throws_ok($$select public.reorder_habits((select array[ids] from alice_order))$$,
  '22023', null, 'a nested reorder array is rejected');
select throws_ok($$select public.reorder_habits(array(select gen_random_uuid() from generate_series(1, 21)))$$,
  '22023', null, 'a reorder of more than 20 ids is rejected before locking');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.archive_habit('bbbbbbbb-0000-0000-0000-000000000001');
select lives_ok($$select public.reorder_habits('{}'::uuid[])$$,
  'an empty reorder is accepted when there are no active habits');

-- ── Signed out (no sub claim) ───────────────────────────────────────────────
select pg_temp.as_no_sub();
select throws_ok($$select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '28000', 'Not signed in', 'archive_habit requires a signed-in user');
select throws_ok($$select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000002')$$,
  '28000', 'Not signed in', 'unarchive_habit requires a signed-in user');
select throws_ok($$select public.reorder_habits('{}'::uuid[])$$,
  '28000', 'Not signed in', 'reorder_habits requires a signed-in user');

-- ── Creation limits (archive-and-recreate churn) ────────────────────────────
-- Carol: 29 archived habits created today (inserted as postgres; archived so
-- the active cap doesn't apply), then her own 30th succeeds and 31st fails.
select pg_temp.as_postgres();
insert into public.habits (user_id, title, category, archived_at)
  select '33333333-3333-3333-3333-333333333333', 'Old ' || g, 'other', now()
  from generate_series(1, 29) as g;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select lives_ok($$insert into public.habits (title, category) values ('thirtieth', 'mind')$$,
  'the 30th habit created in a day is accepted');
select throws_ok($$insert into public.habits (title, category) values ('thirty-first', 'mind')$$,
  'QX001', 'You can create at most 30 habits a day', 'the 31st habit created in a day is rejected');

-- Age Carol's habits past the 24-hour window but inside 30 days, and bring
-- her to 100 created in 30 days.
select pg_temp.as_postgres();
update public.habits set created_at = now() - interval '2 days'
  where user_id = '33333333-3333-3333-3333-333333333333';
insert into public.habits (user_id, title, category, archived_at, created_at)
  select '33333333-3333-3333-3333-333333333333', 'Older ' || g, 'other', now(), now() - interval '2 days'
  from generate_series(1, 70) as g;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select throws_ok($$insert into public.habits (title, category) values ('hundred and first', 'mind')$$,
  'QX001', 'You can create at most 100 habits in 30 days',
  'a user cannot create more than 100 habits in 30 days');

-- Once they age out of the window, creating works again: no permanent lockout.
select pg_temp.as_postgres();
update public.habits set created_at = now() - interval '31 days'
  where user_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select lives_ok($$insert into public.habits (title, category) values ('fresh start', 'mind')$$,
  'old habits age out of the creation windows');

-- ── service_role writes still go through the trigger ────────────────────────
select pg_temp.as_postgres();
set local role service_role;
select lives_ok(
  $$insert into public.habits (user_id, title, category, template_key)
    values ('33333333-3333-3333-3333-333333333333', U&' svc\2066 ', 'mind', 'svc')$$,
  'service_role can insert habits after the internal revokes');
select is((select title from public.habits where template_key = 'svc'), 'svc',
  'service_role inserts are still cleaned by the trigger');
select lives_ok(
  $$update public.habits set archived_at = now() where template_key = 'svc'$$,
  'service_role can archive habits after the internal revokes');
reset role;

-- ── Account deletion cascades ───────────────────────────────────────────────
select pg_temp.as_postgres();
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.habits
           where user_id = '22222222-2222-2222-2222-222222222222'), 0,
  'deleting an account deletes its habits');

-- ── Parity with the JS mirror (lib/validation/habit.ts cleanHabitText) ─────
-- \s depends on the database's ctype; these pin what the Zod schema assumes,
-- so a database image whose ctype differs fails here instead of in the forms.
select pg_temp.as_postgres();
select is(public.habits_clean_text(U&'\0085\1680\2007\2028\202F\3000Read\0085\3000'), 'Read',
  'Unicode spaces and NEL are trimmed at the ends, as in JS');
select is(public.habits_clean_text(U&'a\00ADb\061Cc\180Ed\200Be\200Ef\200Fg\202Ah\202Ei\2060j\206Fk\3164l\FEFFm'),
  'abcdefghijklm', 'every stripped range edge is removed inside text');
select is(public.habits_clean_text(U&'a\00ACb\200Ac\2010d\202Fe\205Ff\2070g'),
  U&'a\00ACb\200Ac\2010d\202Fe\205Ff\2070g', 'neighbours of the stripped ranges are kept');
select is(public.habits_clean_text(U&'\200C\200Da\200Db\200C\200D'), U&'a\200Db',
  'joiners are trimmed at the ends and kept inside');

select * from finish();
rollback;
