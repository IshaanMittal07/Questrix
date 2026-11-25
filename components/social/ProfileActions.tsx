"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { report, setBlocked, setFollowing } from "@/lib/social/actions";

/** Follow / unfollow, report and block on a public profile. */
export function ProfileActions({
  userId,
  username,
  following,
  followers,
}: {
  userId: string;
  username: string;
  following: boolean;
  followers: number;
}) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(following);
  const [count, setCount] = useState(followers);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function toggleFollow() {
    const next = !isFollowing;
    setIsFollowing(next);
    setCount((n) => n + (next ? 1 : -1));
    setError("");
    start(async () => {
      const res = await setFollowing(userId, next);
      if (!res.ok) {
        setIsFollowing(!next);
        setCount((n) => n + (next ? -1 : 1));
        setError(res.error);
      } else {
        setStatus(
          next ? `Following @${username}.` : `Unfollowed @${username}.`,
        );
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-muted text-sm" data-testid="followers">
        {count} {count === 1 ? "follower" : "followers"}
      </p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={isFollowing ? "secondary" : "primary"}
          aria-pressed={isFollowing}
          onClick={toggleFollow}
          disabled={pending}
        >
          {isFollowing ? "Following" : "Follow"}
        </Button>
        <Button
          variant="secondary"
          aria-label={`More actions for @${username}`}
          onClick={() => setMenu(true)}
        >
          ⋯
        </Button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <Sheet open={menu} onOpenChange={setMenu} title={`@${username}`}>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setMenu(false);
              start(async () => {
                const res = await report("user", userId);
                if (res.ok) setStatus("Thanks. We'll take a look.");
                else setError(res.error);
              });
            }}
          >
            Report @{username}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setMenu(false);
              start(async () => {
                const res = await setBlocked(userId, true);
                if (!res.ok) return setError(res.error);
                router.push("/feed");
              });
            }}
          >
            Block @{username}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
