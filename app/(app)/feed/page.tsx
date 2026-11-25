import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedView } from "@/components/social/FeedView";
import { Card } from "@/components/ui/Card";
import { loadFeedPage } from "@/lib/social/queries";

export const metadata: Metadata = { title: "Feed" };

async function FeedContent() {
  const page = await loadFeedPage("everyone");
  if (!page) {
    return (
      <Card role="alert">
        <p className="text-danger">
          Couldn&apos;t load the feed. Reload the page, or try again shortly.
        </p>
      </Card>
    );
  }
  return (
    <FeedView initial={page.posts} initialTab="everyone" unread={page.unread} />
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <FeedContent />
    </Suspense>
  );
}
