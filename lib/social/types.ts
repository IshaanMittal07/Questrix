import { assetSvg, type AvatarLayers } from "@/components/avatar/Avatar";
import { assetCss } from "@/lib/shop/types";

/** A post as the feed renders it (from get_feed). */
export type FeedPost = {
  id: string;
  body: string;
  attachment: WeeklySummary | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  mine: boolean;
  liked: boolean;
  author: FeedAuthor;
};

export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  layers: AvatarLayers;
  nameColor: string | null;
  nameStyle: string | null;
};

export type WeeklySummary = {
  streak: number;
  completions: number;
  points: number;
  level: number;
};

export type FeedTab = "everyone" | "following";
export type Cursor = { createdAt: string; id: string };

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Author fields + equipped cosmetics, each asset through its allowlist. */
export function parseAuthor(a: Row): FeedAuthor {
  return {
    id: str(a.id),
    username: str(a.username),
    displayName: typeof a.display_name === "string" ? a.display_name : null,
    layers: {
      background: assetSvg(a.background),
      border: assetSvg(a.border),
      avatarBase: assetSvg(a.avatar_base),
      outfit: assetSvg(a.outfit),
      accessory: assetSvg(a.accessory),
    },
    nameColor: assetCss(a.name_color),
    nameStyle: assetCss(a.name_style),
  };
}

function parseSummary(v: unknown): WeeklySummary | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Row;
  if (s.type !== "weekly_summary") return null;
  return {
    streak: num(s.streak),
    completions: num(s.completions),
    points: num(s.points),
    level: num(s.level),
  };
}

export function parseFeed(data: unknown): FeedPost[] {
  if (!Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    id: str(r.id),
    body: str(r.body),
    attachment: parseSummary(r.attachment),
    likeCount: num(r.like_count),
    commentCount: num(r.comment_count),
    createdAt: str(r.created_at),
    mine: r.mine === true,
    liked: r.liked === true,
    author: parseAuthor((r.author ?? {}) as Row),
  }));
}

export const PAGE_SIZE = 20;

/** "now", "5m", "3h", "2d", or a short date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
