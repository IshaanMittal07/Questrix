-- Phase 2: profiles, inventory, equip_item — RLS, column privileges, triggers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- Helpers: act as a given user (or anon) inside this transaction.
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

-- Two users via the real signup path (auth.users insert fires the trigger).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"full_name":"Alice A"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}');

-- ── Signup trigger ──────────────────────────────────────────────────────────
select is(
  (select username::text from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'user_111111111111', 'signup creates a profile with a placeholder username');
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice A', 'display name comes from OAuth metadata');
select is(
  (select onboarded_at from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null, 'new users are not onboarded yet');
select is(
  (select count(*)::int from public.user_items where user_id = '11111111-1111-1111-1111-111111111111'),
  (select count(*)::int from public.items where is_default),
  'signup grants every default item');
select isnt(
  (select avatar_base_id from public.equipped_cosmetics where user_id = '11111111-1111-1111-1111-111111111111'),
  null, 'signup equips a default avatar base');

-- ── profiles RLS + column privileges ────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.profiles), 1,
  'a user can only read their own profile row');

select lives_ok(
  $$update public.profiles set username = 'alice', timezone = 'America/Toronto'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  'a user can update their own username and timezone');

update public.profiles set display_name = 'hacked' where id = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$update public.profiles set points_balance = 99999
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'a user cannot update their own points_balance');
select throws_ok(
  $$update public.profiles set current_streak = 500
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'a user cannot update their own streak');
select throws_ok(
  $$update public.profiles set onboarded_at = null
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'a user cannot write onboarded_at');
select throws_ok(
  $$insert into public.profiles (id, username) values (gen_random_uuid(), 'mallory')$$,
  '42501', null, 'clients cannot insert profiles');
select throws_ok(
  $$delete from public.profiles where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'clients cannot delete profiles');
select throws_ok(
  $$update public.profiles set timezone = 'Mars/Olympus'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '22023', null, 'an unknown timezone is rejected');
select throws_ok(
  $$update public.profiles set username = 'Bad Name!'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'usernames must match ^[a-z0-9_]{3,20}$');

select throws_ok(
  $$update public.profiles set username = 'admin'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'reserved usernames cannot be taken by a direct update');
select throws_ok(
  $$update public.profiles set username = 'user_abcdef123456'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'the user_ placeholder namespace cannot be taken by a direct update');

select pg_temp.as_postgres();
select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null, 'a user cannot update another user''s profile');
select isnt(
  (select onboarded_at from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null, 'choosing a username marks the user onboarded');

-- ── username_available ──────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(public.username_available('alice'), false, 'taken usernames are unavailable');
select is(public.username_available('ALICE'), false, 'upper-case input is rejected (usernames are lowercase)');
select is(public.username_available('bob_99'), true, 'free usernames are available');
select is(public.username_available('no'), false, 'too-short usernames are unavailable');
select is(public.username_available('admin'), false, 'reserved usernames are unavailable');
select is(public.username_available('user_222222222222'), false, 'the placeholder namespace is reserved');

-- ── public_profiles + privacy ───────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.profiles set is_private = true where id = '11111111-1111-1111-1111-111111111111';
select isnt(
  (select current_streak from public.public_profiles where username = 'alice'),
  null, 'owners see their own stats even when private');

select pg_temp.as_postgres();
update public.profiles set username = 'bob' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(
  (select current_streak from public.public_profiles where username = 'alice'),
  null, 'private stats are hidden from other users');
select is(
  (select username::text from public.public_profiles where username = 'alice'),
  'alice', 'username stays visible on private profiles');

select pg_temp.as_postgres();
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.public_profiles
    where id = '33333333-3333-3333-3333-333333333333'),
  0, 'users who have not onboarded are hidden from others');

-- ── items ───────────────────────────────────────────────────────────────────
select pg_temp.as_postgres();
insert into public.items (slug, name, category, rarity, price, asset, is_active)
values ('test-retired', 'Retired Cape', 'outfit', 'rare', 100, '{}', false);
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.items where slug = 'test-retired'),
  0, 'inactive items are hidden');
select throws_ok(
  $$insert into public.items (slug, name, category, rarity, price, asset)
    values ('free-crown', 'Free Crown', 'accessory', 'legendary', 0, '{}')$$,
  '42501', null, 'clients cannot create items');

-- ── inventory + equip_item ──────────────────────────────────────────────────
select throws_ok(
  $$insert into public.user_items (user_id, item_id)
    select '22222222-2222-2222-2222-222222222222', id from public.items limit 1$$,
  '42501', null, 'clients cannot grant themselves items');
select cmp_ok(
  (select count(*)::int from public.user_items), '>', 0,
  'a user can read their own inventory');
select is(
  (select count(*)::int from public.user_items
    where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'a user cannot read another user''s inventory');
select is(
  (select count(*)::int from public.equipped_cosmetics
    where user_id = '11111111-1111-1111-1111-111111111111'),
  1, 'equipped cosmetics are visible to other signed-in users');
select throws_ok(
  $$update public.equipped_cosmetics set outfit_id = null$$,
  '42501', null, 'clients cannot write equipped_cosmetics directly');
select lives_ok(
  $$select public.equip_item('avatar_base', (select id from public.items where slug = 'base-umbra'))$$,
  'a user can equip an owned item in its slot');
select is(
  (select avatar_base_id from public.equipped_cosmetics where user_id = '22222222-2222-2222-2222-222222222222'),
  (select id from public.items where slug = 'base-umbra'), 'equip_item updates the slot');
select throws_ok(
  $$select public.equip_item('outfit', (select id from public.items where slug = 'base-umbra'))$$,
  '22023', null, 'items cannot go in the wrong slot');
select throws_ok(
  $$select public.equip_item('avatar_base', null)$$,
  '22023', null, 'the avatar base cannot be unequipped');

select pg_temp.as_postgres();
insert into public.items (slug, name, category, rarity, price, asset)
values ('test-hoodie', 'Test Hoodie', 'outfit', 'rare', 600, '{}');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$select public.equip_item('outfit', (select id from public.items where slug = 'test-hoodie'))$$,
  '42501', null, 'unowned items cannot be equipped');

-- ── delete rules + function privileges ─────────────────────────────────────
select pg_temp.as_postgres();
select throws_ok(
  $$delete from public.items where slug = 'base-umbra'$$,
  '23503', null, 'owned items cannot be deleted (retire them with is_active)');
select is(has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  false, 'clients cannot execute handle_new_user');
select is(has_function_privilege('authenticated', 'public.profiles_validate()', 'execute'),
  false, 'clients cannot execute profiles_validate');
select is(has_function_privilege('authenticated', 'public.strip_auth_password()', 'execute'),
  false, 'clients cannot execute strip_auth_password');

-- ── passwordless auth ───────────────────────────────────────────────────────
insert into auth.users (id, email, encrypted_password) values
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com', 'attacker-hash');
select is(
  (select encrypted_password from auth.users where id = '44444444-4444-4444-4444-444444444444'),
  '', 'a password given at signup is never stored');
update auth.users set encrypted_password = 'planted-hash'
  where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select encrypted_password from auth.users where id = '22222222-2222-2222-2222-222222222222'),
  '', 'a password set later is never stored');
insert into auth.users (id, email, encrypted_password) values
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com', null);
select is(
  (select encrypted_password from auth.users where id = '55555555-5555-5555-5555-555555555555'),
  null, 'a NULL password stays NULL');

-- ── anon ────────────────────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$select * from public.profiles$$, '42501', null,
  'anonymous users cannot read profiles');
select throws_ok($$select public.username_available('x_y_z')$$, '42501', null,
  'anonymous users cannot call username_available');
select throws_ok($$select * from public.public_profiles$$, '42501', null,
  'anonymous users cannot read public_profiles');
select throws_ok($$select * from public.items$$, '42501', null,
  'anonymous users cannot read items');
select throws_ok($$select * from public.equipped_cosmetics$$, '42501', null,
  'anonymous users cannot read equipped_cosmetics');
select throws_ok($$select public.equip_item('outfit', null)$$, '42501', null,
  'anonymous users cannot call equip_item');
select throws_ok($$select public.is_reserved_username('admin')$$, '42501', null,
  'anonymous users cannot call is_reserved_username');

select * from finish();
rollback;
