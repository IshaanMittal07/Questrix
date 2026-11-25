import "server-only";

import {
  PAGE_SIZE,
  parseAuthor,
  parseFeed,
  type FeedTab,
} from "@/lib/social/types";
import { getVerifiedUser } from "@/lib/supabase/session";

export async function loadFeedPage(tab: FeedTab, author: string | null = null) {
  const s = await getVerifiedUser();
  if (!s) return null;
  const [{ data, error }, { count }] = await Promise.all([
    s.supabase.rpc("get_feed", {
      p_tab: tab,
      p_limit: PAGE_SIZE,
      ...(author && { p_author: author }),
    }),
    s.supabase
      .from("notifications_inbox")
      .select("id", { count: "exact", head: true })
      .eq("user_id", s.userId)
      .is("read_at", null),
  ]);
  if (error) return null;
  return { posts: parseFeed(data), unread: count ?? 0 };
}

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  isPrivate: boolean;
  isMe: boolean;
  level: number | null;
  currentStreak: number | null;
  longestStreak: number | null;
  followers: number;
  following: number;
  iFollow: boolean;
  today: string;
  heatmap: Record<string, number> | null;
  title: string | null;
  author: ReturnType<typeof parseAuthor>;
};

type Row = Record<string, unknown>;

export async function loadPublicProfile(
  username: string,
): Promise<PublicProfile | null> {
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) return null;
  const s = await getVerifiedUser();
  if (!s) return null;
  const { data, error } = await s.supabase.rpc("get_public_profile", {
    p_username: username,
  });
  if (error || !data || typeof data !== "object") return null;
  const p = data as Row;
  const cos = (p.cosmetics ?? {}) as Row;
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: String(p.id),
    username: String(p.username),
    displayName: typeof p.display_name === "string" ? p.display_name : null,
    bio: typeof p.bio === "string" ? p.bio : null,
    isPrivate: p.is_private === true,
    isMe: p.is_me === true,
    level: n(p.level),
    currentStreak: n(p.current_streak),
    longestStreak: n(p.longest_streak),
    followers: n(p.followers) ?? 0,
    following: n(p.following) ?? 0,
    iFollow: p.i_follow === true,
    today: String(p.today),
    heatmap:
      p.heatmap && typeof p.heatmap === "object"
        ? (p.heatmap as Record<string, number>)
        : null,
    title: typeof cos.title === "string" ? cos.title.slice(0, 40) : null,
    author: parseAuthor({
      ...cos,
      id: p.id,
      username: p.username,
      display_name: p.display_name,
    }),
  };
}

export type LeaderRow = {
  userId: string;
  username: string;
  displayName: string | null;
  weekPoints: number;
  rank: number;
};

function toRow(r: Row): LeaderRow {
  return {
    userId: String(r.user_id),
    username: String(r.username),
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    weekPoints: Number(r.week_points) || 0,
    rank: Number(r.rank) || 0,
  };
}

export async function loadLeaderboard(scope: "global" | "friends") {
  const s = await getVerifiedUser();
  if (!s) return null;
  const { data, error } = await s.supabase.rpc("get_leaderboard", {
    p_scope: scope,
  });
  if (error || !data || typeof data !== "object") return null;
  const d = data as Row;
  return {
    rows: Array.isArray(d.rows) ? (d.rows as Row[]).map(toRow) : [],
    me: d.me && typeof d.me === "object" ? toRow(d.me as Row) : null,
    userId: s.userId,
  };
}

export type InboxItem = {
  id: string;
  type: "like" | "comment" | "follow" | "milestone";
  actor: string | null;
  createdAt: string;
  unread: boolean;
};

export async function loadBlocked() {
  const s = await getVerifiedUser();
  if (!s) return [];
  const { data } = await s.supabase.rpc("my_blocked_users");
  return (data ?? []).map((r) => ({ userId: r.user_id, username: r.username }));
}

export async function loadInbox(): Promise<InboxItem[] | null> {
  const s = await getVerifiedUser();
  if (!s) return null;
  const { data, error } = await s.supabase
    .from("notifications_inbox")
    .select("id, type, payload, read_at, created_at")
    .eq("user_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  // Names are read now, not stored: a renamed user's old name could be
  // claimed by someone else (audit L2). Unknown → "Someone".
  const actorOf = (r: { payload: unknown }) => {
    const a = ((r.payload ?? {}) as Row).actor_id;
    return typeof a === "string" ? a : null;
  };
  const ids = [...new Set(data.map(actorOf).filter((x): x is string => !!x))];
  const names = ids.length
    ? (
        await s.supabase
          .from("public_profiles")
          .select("id, username")
          .in("id", ids)
      ).data
    : [];
  const byId = new Map((names ?? []).map((n) => [n.id, n.username]));
  return data.map((r) => {
    const id = actorOf(r);
    return {
      id: r.id,
      type: r.type as InboxItem["type"],
      actor: id ? (byId.get(id) ?? null) : null,
      createdAt: r.created_at,
      unread: r.read_at === null,
    };
  });
}
