"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isClean, UNFRIENDLY_MESSAGE } from "@/lib/moderation/blocklist";
import { PAGE_SIZE, parseFeed, type FeedPost } from "@/lib/social/types";
import { DEADLOCK, RETRY_MESSAGE } from "@/lib/supabase/errors";
import { getVerifiedUser } from "@/lib/supabase/session";
import { uuidSchema } from "@/lib/validation/habit";

/**
 * Social Server Actions. RPCs, RLS and triggers enforce limits, blocks and
 * visibility; these validate input and map SQLSTATEs to copy (D9).
 */

export type Fail = { ok: false; error: string };
export type Ok<T = object> = { ok: true } & T;

const fail = (error: string): Fail => ({ ok: false, error });
const SIGNED_OUT = "You're signed out.";

function mapError(
  e: { code?: string },
  fallback = "Couldn't save. Try again.",
) {
  switch (e.code) {
    case "QX301":
      return fail("Slow down a little and try again later.");
    case "QX302":
      return fail(UNFRIENDLY_MESSAGE);
    case "QX303":
      return fail("You can't interact with this user.");
    case "QX107":
      return fail("Finish setting up your account first.");
    case "P0002":
    case "42501":
      return fail("That's no longer available.");
    case "22023":
      return fail("Check the text and try again.");
    case "28000":
      return fail(SIGNED_OUT);
    case DEADLOCK:
      return fail(RETRY_MESSAGE);
    default:
      return fail(fallback);
  }
}

const postSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(1000),
  attach: z.boolean(),
});

export async function createPost(
  body: unknown,
  attach: unknown,
): Promise<Ok<{ post: FeedPost | null }> | Fail> {
  const input = postSchema.safeParse({ body, attach });
  if (!input.success) {
    return fail(input.error.issues[0]?.message ?? "Check the text.");
  }
  if (!isClean(input.data.body)) return fail(UNFRIENDLY_MESSAGE);
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { data: id, error } = await s.supabase.rpc("create_post", {
    p_body: input.data.body,
    p_attach_summary: input.data.attach,
  });
  if (error) return mapError(error);
  // Read it back through the feed so the client gets the rendered shape.
  const { data } = await s.supabase.rpc("get_feed", {
    p_tab: "everyone",
    p_limit: 1,
    p_author: s.userId,
  });
  revalidatePath("/feed");
  return { ok: true, post: parseFeed(data).find((p) => p.id === id) ?? null };
}

export async function deletePost(postId: unknown): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(postId);
  if (!id.success) return fail("That's no longer available.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = await s.supabase.rpc("delete_post", { p_post_id: id.data });
  if (error) return mapError(error);
  revalidatePath("/feed");
  return { ok: true };
}

const cursorSchema = z
  .object({ createdAt: z.string().min(1).max(40), id: uuidSchema })
  .nullable();

export async function loadFeed(
  tab: unknown,
  cursor: unknown,
  author: unknown = null,
): Promise<Ok<{ posts: FeedPost[] }> | Fail> {
  const t = z.enum(["everyone", "following"]).safeParse(tab);
  const c = cursorSchema.safeParse(cursor ?? null);
  const a = uuidSchema.nullable().safeParse(author ?? null);
  if (!t.success || !c.success || !a.success) {
    return fail("Couldn't load posts.");
  }
  if (c.data && Number.isNaN(Date.parse(c.data.createdAt))) {
    return fail("Couldn't load posts.");
  }
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { data, error } = await s.supabase.rpc("get_feed", {
    p_tab: t.data,
    p_limit: PAGE_SIZE,
    ...(c.data && {
      p_before_created: c.data.createdAt,
      p_before_id: c.data.id,
    }),
    ...(a.data && { p_author: a.data }),
  });
  if (error) return mapError(error, "Couldn't load posts.");
  return { ok: true, posts: parseFeed(data) };
}

export async function setLike(
  postId: unknown,
  like: unknown,
): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(postId);
  if (!id.success || typeof like !== "boolean") return fail("Couldn't save.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = like
    ? await s.supabase
        .from("post_likes")
        .insert({ post_id: id.data, user_id: s.userId })
    : await s.supabase
        .from("post_likes")
        .delete()
        .eq("post_id", id.data)
        .eq("user_id", s.userId);
  // 23505: already liked, which is the state the user wants.
  if (error && error.code !== "23505") return mapError(error);
  return { ok: true };
}

const COMMENTS_SHOWN = 100;

export type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: { username: string; displayName: string | null };
};

export async function loadComments(
  postId: unknown,
): Promise<Ok<{ comments: CommentView[]; truncated: boolean }> | Fail> {
  const id = uuidSchema.safeParse(postId);
  if (!id.success) return fail("Couldn't load comments.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { data, error } = await s.supabase
    .from("comments")
    .select("id, body, created_at, author_id")
    .eq("post_id", id.data)
    // The newest 100, so a just-posted comment always shows; shown
    // oldest-first below.
    .order("created_at", { ascending: false })
    .limit(COMMENTS_SHOWN);
  if (error) return mapError(error, "Couldn't load comments.");
  const authorIds = [...new Set(data.map((c) => c.author_id))];
  const authors = authorIds.length
    ? (
        await s.supabase
          .from("public_profiles")
          .select("id, username, display_name")
          .in("id", authorIds)
      ).data
    : [];
  const byId = new Map((authors ?? []).map((a) => [a.id, a]));
  return {
    ok: true,
    truncated: data.length === COMMENTS_SHOWN,
    comments: [...data].reverse().map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      mine: c.author_id === s.userId,
      author: {
        username: byId.get(c.author_id)?.username ?? "someone",
        displayName: byId.get(c.author_id)?.display_name ?? null,
      },
    })),
  };
}

const commentSchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(500);

export async function addComment(
  postId: unknown,
  body: unknown,
): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(postId);
  const b = commentSchema.safeParse(body);
  if (!id.success) return fail("That's no longer available.");
  if (!b.success) return fail(b.error.issues[0]?.message ?? "Check the text.");
  if (!isClean(b.data)) return fail(UNFRIENDLY_MESSAGE);
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = await s.supabase.rpc("create_comment", {
    p_post_id: id.data,
    p_body: b.data,
  });
  if (error) return mapError(error);
  return { ok: true };
}

export async function deleteComment(commentId: unknown): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(commentId);
  if (!id.success) return fail("That's no longer available.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = await s.supabase.rpc("delete_comment", {
    p_comment_id: id.data,
  });
  if (error) return mapError(error);
  return { ok: true };
}

const reportSchema = z.object({
  type: z.enum(["post", "comment", "user"]),
  id: uuidSchema,
  reason: z.string().trim().max(300),
});

export async function report(
  type: unknown,
  targetId: unknown,
  reason: unknown = "",
): Promise<Ok | Fail> {
  const input = reportSchema.safeParse({ type, id: targetId, reason });
  if (!input.success) return fail("Couldn't send the report.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = await s.supabase.rpc("report_content", {
    p_target_type: input.data.type,
    p_target_id: input.data.id,
    p_reason: input.data.reason,
  });
  if (error) return mapError(error, "Couldn't send the report.");
  return { ok: true };
}

/** Block or unblock (blocking also removes follows both ways, in SQL). */
export async function setBlocked(
  userId: unknown,
  blocked: unknown,
): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(userId);
  if (!id.success || typeof blocked !== "boolean") {
    return fail("Couldn't save.");
  }
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  if (id.data === s.userId) return fail("You can't block yourself.");
  const { error } = blocked
    ? await s.supabase
        .from("blocks")
        .insert({ blocker_id: s.userId, blocked_id: id.data })
    : await s.supabase
        .from("blocks")
        .delete()
        .eq("blocker_id", s.userId)
        .eq("blocked_id", id.data);
  if (error && error.code !== "23505") return mapError(error);
  revalidatePath("/feed");
  revalidatePath("/settings");
  return { ok: true };
}

export async function setFollowing(
  userId: unknown,
  follow: unknown,
): Promise<Ok | Fail> {
  const id = uuidSchema.safeParse(userId);
  if (!id.success || typeof follow !== "boolean") return fail("Couldn't save.");
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  if (id.data === s.userId) return fail("You can't follow yourself.");
  const { error } = follow
    ? await s.supabase
        .from("follows")
        .insert({ follower_id: s.userId, followee_id: id.data })
    : await s.supabase
        .from("follows")
        .delete()
        .eq("follower_id", s.userId)
        .eq("followee_id", id.data);
  if (error && error.code !== "23505") return mapError(error);
  revalidatePath("/feed");
  return { ok: true };
}

/**
 * Marks read what the Activity page showed: items up to `through` (the
 * newest shown), so anything that arrived after the render stays unread.
 */
export async function markInboxRead(through: unknown): Promise<Ok | Fail> {
  if (typeof through !== "string" || Number.isNaN(Date.parse(through))) {
    return fail("Couldn't save.");
  }
  const s = await getVerifiedUser();
  if (!s) return fail(SIGNED_OUT);
  const { error } = await s.supabase
    .from("notifications_inbox")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", s.userId)
    .is("read_at", null)
    .lte("created_at", through);
  if (error) return mapError(error);
  return { ok: true };
}
