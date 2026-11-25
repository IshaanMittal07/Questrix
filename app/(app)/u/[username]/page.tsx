import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { DisplayName } from "@/components/profile/DisplayName";
import { Heatmap } from "@/components/profile/Heatmap";
import { FeedView } from "@/components/social/FeedView";
import { ProfileActions } from "@/components/social/ProfileActions";
import { Card } from "@/components/ui/Card";
import { buildHeatmap } from "@/lib/profile/heatmap";
import { loadFeedPage, loadPublicProfile } from "@/lib/social/queries";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

async function PublicProfileContent({ username }: { username: string }) {
  const p = await loadPublicProfile(username);
  // Unknown, not onboarded, or blocked either way: all look the same.
  if (!p) notFound();
  if (p.isMe) redirect("/profile");
  const page = await loadFeedPage("everyone", p.id);
  const name = p.displayName || p.username;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-3 py-6 text-center">
        <Avatar
          layers={p.author.layers}
          size={128}
          label={`${p.username}'s avatar`}
        />
        <div>
          <h1 className="text-xl font-bold">
            <DisplayName
              name={name}
              colorClass={p.author.nameColor}
              styleClass={p.author.nameStyle}
            />
          </h1>
          <p className="text-muted">@{p.username}</p>
          {p.title ? (
            <p className="text-cyan mt-1 text-sm font-semibold">{p.title}</p>
          ) : null}
          {p.bio ? <p className="mt-2 text-sm">{p.bio}</p> : null}
        </div>
        {p.isPrivate ? (
          <p className="text-muted text-sm">
            This profile&apos;s stats are private.
          </p>
        ) : (
          <dl className="grid w-full grid-cols-3 gap-2">
            {[
              ["Level", p.level],
              ["Streak", p.currentStreak],
              ["Best", p.longestStreak],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface-2 rounded-xl p-2">
                <dt className="text-muted text-xs">{k}</dt>
                <dd className="text-lg font-bold">{v ?? "–"}</dd>
              </div>
            ))}
          </dl>
        )}
        <ProfileActions
          userId={p.id}
          username={p.username}
          following={p.iFollow}
          followers={p.followers}
        />
      </Card>

      {p.heatmap ? (
        <Card>
          <h2 className="mb-2 text-sm font-bold tracking-wider uppercase">
            Activity
          </h2>
          <Heatmap
            weeks={buildHeatmap(p.today, new Map(Object.entries(p.heatmap)))}
          />
        </Card>
      ) : null}

      <h2 className="text-sm font-bold tracking-wider uppercase">Posts</h2>
      <FeedView
        initial={page?.posts ?? []}
        initialTab="everyone"
        composer={false}
        author={p.id}
      />
    </div>
  );
}

async function ProfileFromParams({ params }: Params) {
  const { username } = await params;
  return <PublicProfileContent username={username} />;
}

export default function PublicProfilePage({ params }: Params) {
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <ProfileFromParams params={params} />
    </Suspense>
  );
}
