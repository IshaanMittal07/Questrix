import type { Metadata } from "next";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { Card } from "@/components/ui/Card";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { getMyProfile } from "@/lib/profile/queries";
import { levelProgress } from "@/lib/points/levels";

export const metadata: Metadata = { title: "Today" };

async function Greeting() {
  const me = await getMyProfile();
  if (!me) return null;
  const { profile, layers } = me;
  const { level, current, needed } = levelProgress(profile.lifetime_points);
  const name = profile.display_name || profile.username;

  return (
    <Card className="flex items-center gap-4">
      <Avatar
        layers={layers}
        size={64}
        label={`${profile.username}'s avatar`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-muted text-sm">Welcome back,</p>
        <p className="truncate text-lg font-bold">{name}</p>
        <p className="text-muted text-sm">
          🔥 {profile.current_streak}-day streak · {profile.points_balance} pts
        </p>
      </div>
      <ProgressRing
        value={current}
        max={needed}
        label={`Level ${level} progress`}
        valueText={`${current} of ${needed} XP`}
      >
        {level}
      </ProgressRing>
    </Card>
  );
}

export default function TodayPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Today</h1>
      <Suspense fallback={<Card className="h-24 animate-pulse" />}>
        <Greeting />
      </Suspense>
      <Card>
        <p className="text-muted text-sm">
          Your habits will appear here (Phase 3–4).
        </p>
      </Card>
    </div>
  );
}
