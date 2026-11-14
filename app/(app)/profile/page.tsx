import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getMyProfile } from "@/lib/profile/queries";
import { levelFor } from "@/lib/points/levels";

export const metadata: Metadata = { title: "Profile" };

async function ProfileCard() {
  const me = await getMyProfile();
  if (!me) return null;
  const { profile, layers, title } = me;
  return (
    <Card className="flex flex-col items-center gap-3 py-6 text-center">
      <Avatar
        layers={layers}
        size={128}
        label={`${profile.username}'s avatar`}
      />
      <div>
        <p className="text-xl font-bold">
          {profile.display_name || profile.username}
        </p>
        <p className="text-muted">@{profile.username}</p>
        {title ? (
          <p className="text-cyan mt-1 text-sm font-semibold">{title}</p>
        ) : null}
      </div>
      <dl className="grid w-full grid-cols-3 gap-2 pt-2">
        {[
          ["Level", levelFor(profile.lifetime_points)],
          ["Streak", profile.current_streak],
          ["Best", profile.longest_streak],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface-2 rounded-xl p-2">
            <dt className="text-muted text-xs">{k}</dt>
            <dd className="text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wider uppercase">Profile</h1>
        <Button asChild variant="secondary">
          <Link href="/settings">Settings</Link>
        </Button>
      </div>
      <Suspense fallback={<Card className="h-72 animate-pulse" />}>
        <ProfileCard />
      </Suspense>
    </div>
  );
}
