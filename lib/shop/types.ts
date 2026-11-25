/** Shop data shared by the server loader and the client view (no server imports). */

export const SLOTS = [
  "avatar_base",
  "outfit",
  "accessory",
  "name_color",
  "name_style",
  "title",
  "background",
  "border",
] as const;
export type Slot = (typeof SLOTS)[number];
export type Category = Slot | "consumable";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export type ShopItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: Category;
  rarity: Rarity;
  price: number;
  levelRequired: number;
  /** A trusted /cosmetics/ SVG path, a name-* CSS class, or a title's text. */
  svg: string | null;
  css: string | null;
  text: string | null;
};

export type Equipped = Partial<Record<Slot, string | null>>;

export type ShopData = {
  items: ShopItem[];
  owned: string[];
  equipped: Equipped;
  balance: number;
  level: number;
  streakFreezes: number;
  freezeMax: number;
  username: string;
  displayName: string | null;
};

/** Only our own name-color-* / name-style-* classes (items.asset.css). */
const NAME_CLASS = /^name-(?:color|style)-[a-z0-9-]+$/;

export function assetCss(asset: unknown): string | null {
  if (asset && typeof asset === "object" && "css" in asset) {
    const css = (asset as { css: unknown }).css;
    return typeof css === "string" && NAME_CLASS.test(css) ? css : null;
  }
  return null;
}

export function assetText(asset: unknown): string | null {
  if (asset && typeof asset === "object" && "text" in asset) {
    const text = (asset as { text: unknown }).text;
    return typeof text === "string" ? text.slice(0, 40) : null;
  }
  return null;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};
