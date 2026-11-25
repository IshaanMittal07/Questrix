"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { PostCard } from "@/components/social/PostCard";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { isClean, UNFRIENDLY_MESSAGE } from "@/lib/moderation/blocklist";
import { createPost, loadFeed } from "@/lib/social/actions";
import { PAGE_SIZE, type FeedPost, type FeedTab } from "@/lib/social/types";
import { createClient } from "@/lib/supabase/client";

export function FeedView({
  initial,
  initialTab,
  unread,
  composer = true,
  author = null,
}: {
  initial: FeedPost[];
  initialTab: FeedTab;
  unread?: number;
  composer?: boolean;
  /** Only this author's posts (public profile); hides tabs. */
  author?: string | null;
}) {
  const [tab, setTab] = useState<FeedTab>(initialTab);
  const [posts, setPosts] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE_SIZE);
  const [fresh, setFresh] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const newest = useRef(initial[0]?.createdAt ?? null);

  // Realtime: only a "new posts" hint, never the posts themselves (plan §3).
  useEffect(() => {
    if (author) return;
    const supabase = createClient();
    const channel = supabase
      .channel("feed-new-posts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const created = (payload.new as { created_at?: string }).created_at;
          if (!created || !newest.current || created > newest.current) {
            setFresh(true);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [author]);

  function reload(next: FeedTab) {
    setError("");
    start(async () => {
      const res = await loadFeed(next, null, author);
      if (!res.ok) return setError(res.error);
      setPosts(res.posts);
      setDone(res.posts.length < PAGE_SIZE);
      setFresh(false);
      newest.current = res.posts[0]?.createdAt ?? newest.current;
    });
  }

  function more() {
    const last = posts.at(-1);
    if (!last) return;
    start(async () => {
      const res = await loadFeed(
        tab,
        { createdAt: last.createdAt, id: last.id },
        author,
      );
      if (!res.ok) return setError(res.error);
      setPosts((p) => [...p, ...res.posts]);
      setDone(res.posts.length < PAGE_SIZE);
      setStatus(`Loaded ${res.posts.length} more posts.`);
    });
  }

  const list = (
    <>
      {posts.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">
          {tab === "following" && !author
            ? "Follow people to see their posts here."
            : "No posts yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Posts">
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard
                post={p}
                onAnnounce={setStatus}
                onRemoved={(blocked) =>
                  setPosts((ps) =>
                    ps.filter((x) =>
                      blocked ? x.author.id !== p.author.id : x.id !== p.id,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {!done ? (
        <Button variant="secondary" onClick={more} disabled={pending}>
          Load more
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {!author ? (
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-wider uppercase">Feed</h1>
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href="/leaderboard">Ranks</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/activity">
                Activity
                {unread ? (
                  <span className="bg-magenta text-bg ml-1 rounded-full px-1.5 text-xs font-bold">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      {composer ? (
        <Composer
          onPosted={(post) => {
            if (post) setPosts((ps) => [post, ...ps]);
            if (post) newest.current = post.createdAt;
            setStatus("Posted.");
          }}
        />
      ) : null}

      {fresh ? (
        <Button onClick={() => reload(tab)} className="self-center">
          New posts. Show them
        </Button>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {author ? (
        list
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as FeedTab);
            reload(v as FeedTab);
          }}
        >
          <TabsList aria-label="Feed">
            <TabsTrigger value="following">Following</TabsTrigger>
            <TabsTrigger value="everyone">Everyone</TabsTrigger>
          </TabsList>
          <div className="mt-4 flex flex-col gap-3">{list}</div>
        </Tabs>
      )}
    </div>
  );
}

function Composer({ onPosted }: { onPosted: (p: FeedPost | null) => void }) {
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isClean(body)) return setError(UNFRIENDLY_MESSAGE);
    setError("");
    start(async () => {
      const res = await createPost(body, attach);
      if (!res.ok) return setError(res.error);
      setBody("");
      onPosted(res.post);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-surface flex flex-col gap-3 rounded-2xl border border-white/8 p-4"
    >
      <label htmlFor="compose" className="text-sm font-semibold">
        Share your progress
      </label>
      <textarea
        id="compose"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="What did you level up today?"
        className="bg-surface-2 rounded-xl p-3 text-sm"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={attach}
            onChange={(e) => setAttach(e.target.checked)}
            className="size-5"
          />
          Attach my weekly summary
        </label>
        <Button type="submit" disabled={pending || !body.trim()}>
          Post
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
