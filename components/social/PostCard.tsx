"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { DisplayName } from "@/components/profile/DisplayName";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import {
  addComment,
  deleteComment,
  deletePost,
  loadComments,
  report,
  setBlocked,
  setLike,
  type CommentView,
} from "@/lib/social/actions";
import { timeAgo, type FeedPost } from "@/lib/social/types";

/**
 * One post. Body and comments are rendered as React text, never as HTML, so a
 * post containing markup shows that markup literally (plan §12 XSS check).
 */
export function PostCard({
  post,
  onRemoved,
  onAnnounce,
}: {
  post: FeedPost;
  /** The post is gone from this viewer's feed (deleted, or author blocked). */
  onRemoved: (authorBlocked: boolean) => void;
  onAnnounce: (message: string) => void;
}) {
  const [liked, setLiked] = useState(post.liked);
  const [likes, setLikes] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [pending, start] = useTransition();
  const name = post.author.displayName || post.author.username;

  function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    start(async () => {
      const res = await setLike(post.id, next);
      if (!res.ok) {
        setLiked(!next);
        setLikes((n) => n + (next ? -1 : 1));
        setError(res.error);
      }
    });
  }

  function toggleComments() {
    const next = !open;
    setOpen(next);
    if (next && comments === null) {
      start(async () => {
        const res = await loadComments(post.id);
        if (res.ok) {
          setComments(res.comments);
          setTruncated(res.truncated);
        } else setError(res.error);
      });
    }
  }

  function submitComment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body = draft;
    start(async () => {
      const res = await addComment(post.id, body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft("");
      setCommentCount((n) => n + 1);
      const fresh = await loadComments(post.id);
      if (fresh.ok) {
        setComments(fresh.comments);
        setTruncated(fresh.truncated);
      }
      onAnnounce("Comment posted.");
    });
  }

  function removeComment(id: string) {
    start(async () => {
      const res = await deleteComment(id);
      if (!res.ok) return setError(res.error);
      setComments((cs) => cs?.filter((c) => c.id !== id) ?? null);
      setCommentCount((n) => Math.max(0, n - 1));
    });
  }

  function act(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: () => void,
  ) {
    setMenu(false);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Couldn't do that.");
      else done();
    });
  }

  return (
    <article
      className="bg-surface flex flex-col gap-3 rounded-2xl border border-white/8 p-4"
      aria-label={`Post by ${name}`}
    >
      <header className="flex items-center gap-3">
        <Link
          href={`/u/${post.author.username}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar layers={post.author.layers} size={40} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              <DisplayName
                name={name}
                colorClass={post.author.nameColor}
                styleClass={post.author.nameStyle}
              />
            </span>
            <span className="text-muted block text-xs">
              @{post.author.username} ·{" "}
              <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
            </span>
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`More actions for ${name}'s post`}
          onClick={() => setMenu(true)}
        >
          ⋯
        </Button>
      </header>

      <p className="break-words whitespace-pre-wrap" data-testid="post-body">
        {post.body}
      </p>

      {post.attachment ? (
        <dl
          className="border-cyan/30 bg-surface-2 grid grid-cols-4 gap-2 rounded-xl border p-3 text-center"
          aria-label="Weekly summary"
        >
          {(
            [
              ["Streak", post.attachment.streak],
              ["Done", post.attachment.completions],
              ["Points", post.attachment.points],
              ["Level", post.attachment.level],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted text-xs">{k}</dt>
              <dd className="text-cyan font-bold">
                {v.toLocaleString("en-US")}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="ghost"
          aria-pressed={liked}
          aria-label={liked ? `Unlike, ${likes} likes` : `Like, ${likes} likes`}
          onClick={toggleLike}
          disabled={pending}
          className={cn(liked && "text-magenta")}
        >
          {liked ? "♥" : "♡"} {likes}
        </Button>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-label={`Comments, ${commentCount}`}
          onClick={toggleComments}
        >
          💬 {commentCount}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {open ? (
        <section className="flex flex-col gap-2" aria-label="Comments">
          {comments === null ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-muted text-sm">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {truncated ? (
                <li className="text-muted text-xs">
                  Showing the latest {comments.length} comments.
                </li>
              ) : null}
              {comments.map((c) => (
                <li key={c.id} className="bg-surface-2 rounded-xl p-2 text-sm">
                  <span className="font-semibold">@{c.author.username}</span>{" "}
                  <span className="break-words whitespace-pre-wrap">
                    {c.body}
                  </span>
                  {c.mine ? (
                    <button
                      type="button"
                      className="text-muted ml-2 min-h-11 text-xs underline"
                      onClick={() => removeComment(c.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitComment} className="flex gap-2">
            <label className="sr-only" htmlFor={`c-${post.id}`}>
              Add a comment
            </label>
            <input
              id={`c-${post.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Add a comment"
              className="bg-surface-2 min-h-11 flex-1 rounded-xl px-3 text-sm"
            />
            <Button type="submit" disabled={pending || !draft.trim()}>
              Send
            </Button>
          </form>
        </section>
      ) : null}

      <Sheet open={menu} onOpenChange={setMenu} title="Post actions">
        <div className="mt-4 flex flex-col gap-2">
          {post.mine ? (
            <Button
              variant="danger"
              onClick={() =>
                act(
                  () => deletePost(post.id),
                  () => {
                    onAnnounce("Post deleted.");
                    onRemoved(false);
                  },
                )
              }
            >
              Delete post
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  act(
                    () => report("post", post.id),
                    () => onAnnounce("Thanks. We'll take a look."),
                  )
                }
              >
                Report post
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  act(
                    () => setBlocked(post.author.id, true),
                    () => {
                      onAnnounce(`Blocked @${post.author.username}.`);
                      onRemoved(true);
                    },
                  )
                }
              >
                Block @{post.author.username}
              </Button>
            </>
          )}
        </div>
      </Sheet>
    </article>
  );
}
