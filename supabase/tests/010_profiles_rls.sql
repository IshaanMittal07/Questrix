-- Phase 2: profiles, inventory, equip_item — RLS, column privileges, triggers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
select is(public.username_available('ALICE'), false, 'availability is case-insensitive');
select is(public.username_available('bob_99'), true, 'free usernames are available');
select is(public.username_available('no'), false, 'too-short usernames are unavailable');
select is(public.username_available('admin'), false, 'reserved usernames are unavailable');

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

-- ── inventory + equip_item ──────────────────────────────────────────────────
select throws_ok(
  $$insert into public.user_items (user_id, item_id)
    select '22222222-2222-2222-2222-222222222222', id from public.items limit 1$$,
  '42501', null, 'clients cannot grant themselves items');
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

-- ── anon ────────────────────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$select * from public.profiles$$, '42501', null,
  'anonymous users cannot read profiles');

select * from finish();
rollback;
