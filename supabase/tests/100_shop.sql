-- Phase 6: purchase_item and equip_item (plan §12 Phase 6 acceptance).
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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
create function pg_temp.item(p_slug text) returns uuid language sql as $$
  select id from public.items where slug = p_slug $$;
-- Credits through the ledger so balance = sum(ledger) keeps holding.
create function pg_temp.credit(p_uid uuid, p_amount int, p_lifetime int default 0) returns void language sql as $$
  insert into public.points_ledger (user_id, delta, reason) values (p_uid, p_amount, 'admin_adjust');
  update public.profiles set points_balance = points_balance + p_amount,
                             lifetime_points = p_lifetime where id = p_uid;
$$;
create function pg_temp.bal(p_uid uuid) returns int language sql as $$
  select points_balance from public.profiles where id = p_uid $$;

-- u1 onboarded, u2 not onboarded.
insert into auth.users (id, email) values
  ('60000001-0000-0000-0000-000000000000', 'shop1@example.com'),
  ('60000002-0000-0000-0000-000000000000', 'shop2@example.com');
update public.profiles set onboarded_at = now() where id = '60000001-0000-0000-0000-000000000000';
select pg_temp.credit('60000001-0000-0000-0000-000000000000', 1000);
select pg_temp.credit('60000002-0000-0000-0000-000000000000', 1000);
-- A retired item.
insert into public.items (slug, name, category, rarity, price, asset, is_active)
values ('retired-hat', 'Retired Hat', 'accessory', 'common', 10, '{}', false);

-- ── Catalogue ────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.items where category = 'outfit'), 8, '8 outfits');
select is((select count(*)::int from public.items where category = 'accessory' and is_active), 6, '6 accessories');
select is((select count(*)::int from public.items where category = 'name_color'), 8, '8 name colours');
select is((select count(*)::int from public.items where category = 'name_style'), 5, '5 name styles');
select is((select count(*)::int from public.items where category = 'title'), 10, '10 titles');
select is((select count(*)::int from public.items where category = 'background'), 6, '6 backgrounds');
select is((select count(*)::int from public.items where category = 'border'), 6, '6 borders');
select is((select price from public.items where slug = 'streak-freeze'), 400, 'Streak Freeze costs 400');
select is((select count(*)::int from public.items where not is_default and is_active and (
    (rarity = 'common' and price not between 150 and 400) or (rarity = 'rare' and price not between 500 and 900)
    or (rarity = 'epic' and price not between 1500 and 2500) or (rarity = 'legendary' and price not between 5000 and 8000))),
  0, 'every paid price sits in its rarity band');

-- ── Privileges ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.purchase_item(uuid)', 'execute'), 'anon can''t call purchase_item');
select ok(has_function_privilege('authenticated', 'public.purchase_item(uuid)', 'execute'), 'authenticated can');
select ok(not has_table_privilege('authenticated', 'public.user_items', 'insert'), 'clients can''t insert user_items');
select ok(not has_table_privilege('authenticated', 'public.equipped_cosmetics', 'update'), 'clients can''t update equipped_cosmetics');

-- ── Refusals ─────────────────────────────────────────────────────────────────
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.purchase_item(pg_temp.item('neon-hoodie'))$$, '28000', null, 'signed out is refused');

select pg_temp.as_user('60000002-0000-0000-0000-000000000000');
select throws_ok($$select public.purchase_item(pg_temp.item('neon-hoodie'))$$, 'QX107', null, 'not onboarded is refused');

select pg_temp.as_user('60000001-0000-0000-0000-000000000000');
select throws_ok($$select public.purchase_item(null)$$, 'P0002', null, 'a null item is not found');
select throws_ok($$select public.purchase_item(gen_random_uuid())$$, 'P0002', null, 'an unknown item is not found');
select throws_ok($$select public.purchase_item(pg_temp.item('retired-hat'))$$, 'P0002', null, 'a retired item is not for sale');
select throws_ok($$select public.purchase_item(pg_temp.item('nebula'))$$, 'QX201', null, 'insufficient balance is refused');
select throws_ok($$select public.purchase_item(pg_temp.item('astronaut-suit'))$$, 'QX203', null, 'a level-5 item is locked at level 1');
select throws_ok($$select public.purchase_item(pg_temp.item('base-nova'))$$, 'QX202', null, 'a default item is already owned');

-- ── A purchase ───────────────────────────────────────────────────────────────
select is((public.purchase_item(pg_temp.item('neon-hoodie')) ->> 'new_balance')::int, 800, 'buying Neon Hoodie leaves 800');
select pg_temp.as_postgres();
select ok(exists (select 1 from public.user_items where user_id = '60000001-0000-0000-0000-000000000000'
                  and item_id = pg_temp.item('neon-hoodie')), 'it lands in the inventory');
select is((select delta from public.points_ledger where user_id = '60000001-0000-0000-0000-000000000000'
           and reason = 'purchase' and ref_id = pg_temp.item('neon-hoodie')), -200, 'with a -200 purchase ledger entry');
select is((select lifetime_points from public.profiles where id = '60000001-0000-0000-0000-000000000000'), 0,
  'spending never lowers lifetime points');

select pg_temp.as_user('60000001-0000-0000-0000-000000000000');
select throws_ok($$select public.purchase_item(pg_temp.item('neon-hoodie'))$$, 'QX202', null, 'buying it twice is refused');
select is(pg_temp.bal('60000001-0000-0000-0000-000000000000'), 800, 'and costs nothing');

-- ── Level lock lifts at the level ────────────────────────────────────────────
select pg_temp.as_postgres();
select pg_temp.credit('60000001-0000-0000-0000-000000000000', 1200, 800); -- level 5, balance 2000
select pg_temp.as_user('60000001-0000-0000-0000-000000000000');
select is((public.purchase_item(pg_temp.item('astronaut-suit')) ->> 'new_balance')::int, 200, 'at level 5 the suit can be bought');

-- ── Streak Freeze: a consumable with a cap of 2 ──────────────────────────────
select pg_temp.as_postgres();
select pg_temp.credit('60000001-0000-0000-0000-000000000000', 1000, 800); -- balance 1200
select pg_temp.as_user('60000001-0000-0000-0000-000000000000');
select is((public.purchase_item(pg_temp.item('streak-freeze')) ->> 'streak_freezes')::int, 1, 'a first freeze');
select is((public.purchase_item(pg_temp.item('streak-freeze')) ->> 'streak_freezes')::int, 2, 'a second freeze');
select throws_ok($$select public.purchase_item(pg_temp.item('streak-freeze'))$$, 'QX204', null, 'a third freeze is refused');
select is(pg_temp.bal('60000001-0000-0000-0000-000000000000'), 400, 'two freezes cost 800');
select pg_temp.as_postgres();
select ok(not exists (select 1 from public.user_items where item_id = pg_temp.item('streak-freeze')),
  'freezes are not stored as inventory');
select is((select points_balance from public.profiles where id = '60000001-0000-0000-0000-000000000000'),
          (select sum(delta)::int from public.points_ledger where user_id = '60000001-0000-0000-0000-000000000000'),
  'balance still equals the ledger sum');

-- ── equip_item ───────────────────────────────────────────────────────────────
select pg_temp.as_user('60000001-0000-0000-0000-000000000000');
select throws_ok($$select public.equip_item('outfit', pg_temp.item('lab-coat'))$$, '42501', null, 'equipping an unowned item is refused');
select throws_ok($$select public.equip_item('accessory', pg_temp.item('neon-hoodie'))$$, '22023', null, 'equipping into the wrong slot is refused');
select throws_ok($$select public.equip_item('consumable', pg_temp.item('streak-freeze'))$$, '22023', null, 'there is no consumable slot');
select lives_ok($$select public.equip_item('outfit', pg_temp.item('neon-hoodie'))$$, 'equipping an owned outfit works');
select is((select outfit_id from public.equipped_cosmetics where user_id = '60000001-0000-0000-0000-000000000000'),
  pg_temp.item('neon-hoodie'), 'and shows on the avatar');
select lives_ok($$select public.equip_item('title', null)$$, 'a title can be unequipped');

select * from finish();
rollback;
