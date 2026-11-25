import "server-only";

import { cache } from "react";
import { assetSvg, type AvatarLayers } from "@/components/avatar/Avatar";
import { assetCss } from "@/lib/shop/types";
import { createClient } from "@/lib/supabase/server";

const EQUIPPED_SELECT = `
  avatar_base:items!equipped_cosmetics_avatar_base_id_fkey(asset),
  outfit:items!equipped_cosmetics_outfit_id_fkey(asset),
  accessory:items!equipped_cosmetics_accessory_id_fkey(asset),
  background:items!equipped_cosmetics_background_id_fkey(asset),
  border:items!equipped_cosmetics_border_id_fkey(asset),
  title:items!equipped_cosmetics_title_id_fkey(name),
  name_color:items!equipped_cosmetics_name_color_id_fkey(asset),
  name_style:items!equipped_cosmetics_name_style_id_fkey(asset)
`;

/** The signed-in user's profile + equipped avatar layers (deduped per request). */
export const getMyProfile = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: equipped }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("equipped_cosmetics")
      .select(EQUIPPED_SELECT)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!profile) return null;

  const layers: AvatarLayers = {
    background: assetSvg(equipped?.background?.asset),
    border: assetSvg(equipped?.border?.asset),
    avatarBase: assetSvg(equipped?.avatar_base?.asset),
    outfit: assetSvg(equipped?.outfit?.asset),
    accessory: assetSvg(equipped?.accessory?.asset),
  };
  return {
    profile,
    layers,
    title: equipped?.title?.name ?? null,
    nameColor: assetCss(equipped?.name_color?.asset),
    nameStyle: assetCss(equipped?.name_style?.asset),
  };
});
