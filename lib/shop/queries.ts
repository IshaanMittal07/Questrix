import "server-only";

import { assetSvg } from "@/components/avatar/Avatar";
import { levelFor } from "@/lib/points/levels";
import {
  assetCss,
  assetText,
  SLOTS,
  type Category,
  type Equipped,
  type Rarity,
  type ShopData,
} from "@/lib/shop/types";
import { getVerifiedUser } from "@/lib/supabase/session";

/** Everything the Shop screen needs, read through RLS (items, own inventory). */
export async function loadShop(): Promise<ShopData | null> {
  const s = await getVerifiedUser();
  if (!s) return null;
  const { supabase, userId } = s;

  const [items, owned, equipped, profile, freezeMax] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, slug, name, description, category, rarity, price, asset, level_required",
      )
      .order("price")
      .order("name"),
    supabase.from("user_items").select("item_id").eq("user_id", userId),
    supabase
      .from("equipped_cosmetics")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select(
        "username, display_name, points_balance, lifetime_points, streak_freezes",
      )
      .eq("id", userId)
      .single(),
    supabase
      .from("economy_config")
      .select("value")
      .eq("key", "streak_freezes_max")
      .maybeSingle(),
  ]);
  if (items.error || !profile.data) return null;

  const eq: Equipped = {};
  if (equipped.data) {
    const row = equipped.data as Record<string, string | null>;
    for (const slot of SLOTS) eq[slot] = row[`${slot}_id`] ?? null;
  }

  return {
    items: items.data.map((i) => ({
      id: i.id,
      slug: i.slug,
      name: i.name,
      description: i.description,
      category: i.category as Category,
      rarity: i.rarity as Rarity,
      price: i.price,
      levelRequired: i.level_required,
      svg: assetSvg(i.asset),
      css: assetCss(i.asset),
      text: assetText(i.asset),
    })),
    owned: (owned.data ?? []).map((o) => o.item_id),
    equipped: eq,
    balance: profile.data.points_balance,
    level: levelFor(profile.data.lifetime_points),
    streakFreezes: profile.data.streak_freezes,
    freezeMax: Number(freezeMax.data?.value ?? 2),
    username: profile.data.username,
    displayName: profile.data.display_name,
  };
}
