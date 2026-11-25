import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { loadLeaderboard } from "@/lib/social/queries";

export const metadata: Metadata = { title: "Leaderboard" };

type Props = { searchParams: Promise<{ scope?: string }> };

async function Board({ scope }: { scope: "global" | "friends" }) {
  const board = await loadLeaderboard(scope);
  if (!board) {
    return (
      <Card role="alert">
        <p className="text-danger">Couldn&apos;t load the leaderboard.</p>
      </Card>
    );
  }
  return (
    <>
      <Card className="text-center" data-testid="my-rank">
        {board.me ? (
          <p>
            You are{" "}
            <span className="text-cyan text-xl font-bold">
              #{board.me.rank}
            </span>{" "}
            this week with {board.me.weekPoints.toLocaleString("en-US")} points
          </p>
        ) : (
          <p className="text-muted text-sm">
            Earn points this week (with a public profile) to get ranked.
          </p>
        )}
      </Card>
      {board.rows.length === 0 ? (
        <p className="text-muted py-6 text-center text-sm">
          No one is ranked yet this week.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Top 100 this week">
          {board.rows.map((r) => (
            <li
              key={r.userId}
              className={cn(
                "bg-surface flex min-h-11 items-center gap-3 rounded-xl px-4 py-2",
                r.userId === board.userId && "ring-cyan ring-2",
              )}
            >
              <span className="text-muted w-8 font-bold">#{r.rank}</span>
              <Link
                href={`/u/${r.username}`}
                className="min-w-0 flex-1 truncate"
              >
                {r.displayName || r.username}{" "}
                <span className="text-muted text-xs">@{r.username}</span>
              </Link>
              <span className="text-cyan font-bold">
                {r.weekPoints.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Reads the scope (runtime data), so it renders inside Suspense. */
async function ScopedBoard({ searchParams }: Props) {
  const scope = (await searchParams).scope === "friends" ? "friends" : "global";
  return (
    <>
      <nav
        aria-label="Leaderboard scope"
        className="bg-surface-2 flex gap-1 rounded-full p-1"
      >
        {(
          [
            ["global", "Everyone"],
            ["friends", "Friends"],
          ] as const
        ).map(([s, label]) => (
          <Link
            key={s}
            href={
              s === "global" ? "/leaderboard" : "/leaderboard?scope=friends"
            }
            aria-current={scope === s ? "page" : undefined}
            className={cn(
              "text-muted grid min-h-11 flex-1 place-items-center rounded-full text-sm font-semibold",
              scope === s && "bg-surface text-text",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Suspense key={scope} fallback={<Card className="h-72 animate-pulse" />}>
        <Board scope={scope} />
      </Suspense>
    </>
  );
}

export default function LeaderboardPage({ searchParams }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">This week</h1>
      <p className="text-muted text-xs">
        Updated every 10 minutes. Private profiles aren&apos;t ranked.
      </p>
      <Suspense fallback={<Card className="h-72 animate-pulse" />}>
        <ScopedBoard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
