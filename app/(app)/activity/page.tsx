import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MarkRead } from "@/components/social/MarkRead";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { loadInbox, type InboxItem } from "@/lib/social/queries";
import { timeAgo } from "@/lib/social/types";

export const metadata: Metadata = { title: "Activity" };

const TEXT: Record<InboxItem["type"], string> = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "started following you",
  milestone: "reached a milestone",
};

async function Inbox() {
  const items = await loadInbox();
  if (!items) {
    return (
      <Card role="alert">
        <p className="text-danger">Couldn&apos;t load your activity.</p>
      </Card>
    );
  }
  if (items.length === 0) {
    return <p className="text-muted py-8 text-center text-sm">Nothing yet.</p>;
  }
  return (
    <>
      {items.some((i) => i.unread) ? <MarkRead /> : null}
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li
            key={i.id}
            className={cn(
              "bg-surface flex min-h-11 items-center gap-2 rounded-xl px-4 py-3 text-sm",
              i.unread && "border-cyan/50 border",
            )}
          >
            <span className="flex-1">
              {i.actor ? (
                <Link href={`/u/${i.actor}`} className="font-semibold">
                  @{i.actor}
                </Link>
              ) : (
                "Someone"
              )}{" "}
              {TEXT[i.type]}
              {i.unread ? <span className="sr-only"> (new)</span> : null}
            </span>
            <time className="text-muted text-xs" dateTime={i.createdAt}>
              {timeAgo(i.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Activity</h1>
      <Suspense fallback={<Card className="h-72 animate-pulse" />}>
        <Inbox />
      </Suspense>
    </div>
  );
}
