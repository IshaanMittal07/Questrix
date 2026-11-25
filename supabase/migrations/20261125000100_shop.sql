-- Phase 6: the paid catalogue (plan §6.5) and purchase_item (plan §6.4).
--
-- Error codes (D9). The UI maps these, never the message text:
--   28000 not signed in · P0002 item or profile not found · QX107 onboarding not finished
--   QX201 balance too low · QX202 already owned · QX203 level too low · QX204 freeze cap reached

-- ── Catalogue (production data) ───────────────────────────────────────────────
-- Price bands: common 150–300 · rare 500–900 · epic 1,500–2,500 · legendary 5,000–8,000.
insert into public.items (slug, name, description, category, rarity, price, asset, level_required) values
  -- Outfits
  ('neon-hoodie',     'Neon Hoodie',      'Cosy, with a glowing trim.',          'outfit', 'common',     200, '{"svg":"/cosmetics/outfit/neon-hoodie.svg"}', 1),
  ('lab-coat',        'Lab Coat',         'For experiments in discipline.',      'outfit', 'common',     250, '{"svg":"/cosmetics/outfit/lab-coat.svg"}', 1),
  ('cyber-jacket',    'Cyber Jacket',     'High collar, bright seams.',          'outfit', 'rare',       600, '{"svg":"/cosmetics/outfit/cyber-jacket.svg"}', 1),
  ('ninja-gi',        'Ninja Gi',         'Silent, focused, consistent.',        'outfit', 'rare',       750, '{"svg":"/cosmetics/outfit/ninja-gi.svg"}', 1),
  ('astronaut-suit',  'Astronaut Suit',   'Built for long missions.',            'outfit', 'epic',      1800, '{"svg":"/cosmetics/outfit/astronaut-suit.svg"}', 5),
  ('mech-pilot',      'Mech Pilot Armor', 'Plated for the hardest streaks.',     'outfit', 'legendary', 6000, '{"svg":"/cosmetics/outfit/mech-pilot.svg"}', 10),
  ('holo-robe',       'Holo Robe',        'Woven from pure light.',              'outfit', 'legendary', 7000, '{"svg":"/cosmetics/outfit/holo-robe.svg"}', 10),
  -- Accessories
  ('headphones',      'Headphones',       'Lock in.',                            'accessory', 'common',     150, '{"svg":"/cosmetics/accessory/headphones.svg"}', 1),
  ('visor',           'Visor',            'A heads-up display for your day.',    'accessory', 'common',     250, '{"svg":"/cosmetics/accessory/visor.svg"}', 1),
  ('cat-ears',        'Cat Ears',         'Curious and alert.',                  'accessory', 'rare',       500, '{"svg":"/cosmetics/accessory/cat-ears.svg"}', 1),
  ('halo',            'Halo',             'Perfect week energy.',                'accessory', 'rare',       800, '{"svg":"/cosmetics/accessory/halo.svg"}', 1),
  ('jetpack',         'Jetpack',          'Lift-off for your goals.',            'accessory', 'epic',      2000, '{"svg":"/cosmetics/accessory/jetpack.svg"}', 5),
  ('holo-wings',      'Holo Wings',       'Earned, never given.',                'accessory', 'legendary', 6500, '{"svg":"/cosmetics/accessory/holo-wings.svg"}', 10),
  -- Name colours
  ('color-cyan',      'Cyan',             'Cool and clear.',                     'name_color', 'common',     150, '{"css":"name-color-cyan"}', 1),
  ('color-violet',    'Violet',           'Calm intensity.',                     'name_color', 'common',     150, '{"css":"name-color-violet"}', 1),
  ('color-magenta',   'Magenta',          'Loud and proud.',                     'name_color', 'common',     200, '{"css":"name-color-magenta"}', 1),
  ('color-lime',      'Lime',             'Fresh energy.',                       'name_color', 'common',     200, '{"css":"name-color-lime"}', 1),
  ('color-ice',       'Ice',              'Unshakeable cool.',                   'name_color', 'rare',       500, '{"css":"name-color-ice"}', 1),
  ('color-gold',      'Gold',             'Shine on.',                           'name_color', 'rare',       700, '{"css":"name-color-gold"}', 1),
  ('color-sunset',    'Sunset',           'A warm gradient.',                    'name_color', 'epic',      1500, '{"css":"name-color-sunset"}', 1),
  ('color-aurora',    'Aurora',           'A shifting, living gradient.',        'name_color', 'legendary', 5000, '{"css":"name-color-aurora"}', 1),
  -- Name styles
  ('style-bold-caps', 'Bold Caps',        'SAY IT LOUD.',                        'name_style', 'common',     200, '{"css":"name-style-bold-caps"}', 1),
  ('style-outline',   'Outline',          'Hollow letters, sharp edges.',        'name_style', 'rare',       500, '{"css":"name-style-outline"}', 1),
  ('style-glow',      'Glow',             'A soft neon halo.',                   'name_style', 'rare',       600, '{"css":"name-style-glow"}', 1),
  ('style-glitch',    'Glitch',           'Unstable signal.',                    'name_style', 'epic',      2000, '{"css":"name-style-glitch"}', 1),
  ('style-matrix',    'Matrix Rain',      'Falling code.',                       'name_style', 'legendary', 6000, '{"css":"name-style-matrix"}', 1),
  -- Titles
  ('title-early-bird',     'Early Bird',      'Up before the sun.',             'title', 'common',     200, '{"text":"Early Bird"}', 1),
  ('title-night-owl',      'Night Owl',       'Does their best work late.',     'title', 'common',     200, '{"text":"Night Owl"}', 1),
  ('title-code-monk',      'Code Monk',       'Ships daily.',                   'title', 'rare',       500, '{"text":"Code Monk"}', 1),
  ('title-supplement-sage','Supplement Sage', 'Never misses a dose.',           'title', 'rare',       600, '{"text":"Supplement Sage"}', 1),
  ('title-study-sorcerer', 'Study Sorcerer',  'Turns hours into knowledge.',    'title', 'rare',       600, '{"text":"Study Sorcerer"}', 1),
  ('title-iron-will',      'Iron Will',       'Unmoved by excuses.',            'title', 'rare',       800, '{"text":"Iron Will"}', 1),
  ('title-streak-lord',    'Streak Lord',     'Reach level 10 to claim.',       'title', 'epic',      1500, '{"text":"Streak Lord"}', 10),
  ('title-unbreakable',    'Unbreakable',     'Legend status.',                 'title', 'legendary', 5000, '{"text":"Unbreakable"}', 1),
  ('title-ascended',       'Ascended',        'Reach level 20 to claim.',       'title', 'legendary', 8000, '{"text":"Ascended"}', 20),
  -- Backgrounds
  ('starfield',        'Starfield',        'Quiet, endless space.',             'background', 'common',     300, '{"svg":"/cosmetics/background/starfield.svg"}', 1),
  ('circuit-board',    'Circuit Board',    'Every path connects.',              'background', 'rare',       500, '{"svg":"/cosmetics/background/circuit-board.svg"}', 1),
  ('neon-city',        'Neon City',        'Skyline after dark.',               'background', 'rare',       700, '{"svg":"/cosmetics/background/neon-city.svg"}', 1),
  ('synthwave-sunset', 'Synthwave Sunset', 'Retro horizon.',                    'background', 'epic',      1500, '{"svg":"/cosmetics/background/synthwave-sunset.svg"}', 1),
  ('nebula',           'Nebula',           'A slowly breathing cloud of light.','background', 'legendary', 5500, '{"svg":"/cosmetics/background/nebula.svg"}', 1),
  -- Borders
  ('neon-ring',        'Neon Ring',        'A clean glowing ring.',             'border', 'common',     200, '{"svg":"/cosmetics/border/neon-ring.svg"}', 1),
  ('hex-frame',        'Hex Frame',        'Six sides of focus.',               'border', 'rare',       500, '{"svg":"/cosmetics/border/hex-frame.svg"}', 1),
  ('pulse',            'Pulse',            'Beats with your streak.',           'border', 'epic',      1500, '{"svg":"/cosmetics/border/pulse.svg"}', 1),
  ('gold-laurel',      'Gold Laurel',      'For champions.',                    'border', 'epic',      2200, '{"svg":"/cosmetics/border/gold-laurel.svg"}', 1),
  ('plasma',           'Plasma',           'Contained lightning.',              'border', 'legendary', 6000, '{"svg":"/cosmetics/border/plasma.svg"}', 1),
  -- Consumable (not stored in user_items; increments profiles.streak_freezes)
  ('streak-freeze',    'Streak Freeze',    'Covers one missed day. Hold up to 2.', 'consumable', 'common', 400, '{"icon":"freeze"}', 1);

-- ── purchase_item ─────────────────────────────────────────────────────────────
-- Lock order (D5): the profile `for no key update` first, as complete_habit and
-- undo_completion do, so purchases serialise against each other and against
-- the engine: two concurrent purchases can't both pass the balance check.
create function public.purchase_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_item public.items%rowtype;
  v_max int;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into p from public.profiles where id = v_uid for no key update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if p.onboarded_at is null then
    raise exception 'Finish onboarding first' using errcode = 'QX107';
  end if;

  select * into v_item from public.items i where i.id = p_item_id and i.is_active;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  if public.level_for(p.lifetime_points) < v_item.level_required then
    raise exception 'Requires level %', v_item.level_required using errcode = 'QX203';
  end if;

  if v_item.category = 'consumable' then
    if v_item.slug <> 'streak-freeze' then
      raise exception 'Unknown consumable' using errcode = '22023';
    end if;
    v_max := (public.economy_value('streak_freezes_max'))::int;
    if p.streak_freezes >= v_max then
      raise exception 'You already hold % streak freezes', v_max using errcode = 'QX204';
    end if;
  elsif exists (select 1 from public.user_items ui
                where ui.user_id = v_uid and ui.item_id = v_item.id) then
    raise exception 'Already owned' using errcode = 'QX202';
  end if;

  if p.points_balance < v_item.price then
    raise exception 'Not enough points' using errcode = 'QX201';
  end if;

  if v_item.price > 0 then
    insert into public.points_ledger (user_id, delta, reason, ref_id)
    values (v_uid, -v_item.price, 'purchase', v_item.id);
  end if;

  if v_item.category = 'consumable' then
    update public.profiles
       set points_balance = points_balance - v_item.price,
           streak_freezes = streak_freezes + 1
     where id = v_uid
    returning * into p;
  else
    insert into public.user_items (user_id, item_id) values (v_uid, v_item.id);
    update public.profiles
       set points_balance = points_balance - v_item.price
     where id = v_uid
    returning * into p;
  end if;

  return jsonb_build_object(
    'item_id', v_item.id,
    'slug', v_item.slug,
    'category', v_item.category,
    'price', v_item.price,
    'new_balance', p.points_balance,
    'streak_freezes', p.streak_freezes
  );
end;
$$;

revoke all on function public.purchase_item(uuid) from public, anon, service_role;
grant execute on function public.purchase_item(uuid) to authenticated;
