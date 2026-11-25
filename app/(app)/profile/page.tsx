import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { DisplayName } from "@/components/profile/DisplayName";
import { Heatmap } from "@/components/profile/Heatmap";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { levelProgress } from "@/lib/points/levels";
import { buildHeatmap, HEATMAP_WEEKS, localDate } from "@/lib/profile/heatmap";
import { getMyProfile } from "@/lib/profile/queries";
import { getVerifiedUser } from "@/lib/supabase/session";

export const metadata: Metadata = { title: "Profile" };

async function ProfileCard() {
  const [me, s] = await Promise.all([getMyProfile(), getVerifiedUser()]);
  if (!me || !s) return null;
  const { profile, layers, title, nameColor, nameStyle } = me;

  const today = localDate(new Date(), profile.timezone);
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 7 * HEATMAP_WEEKS);
  const [{ data: days }, { data: milestones }] = await Promise.all([
    s.supabase
      .from("daily_progress")
      .select("local_date, completed_count")
      .eq("user_id", s.userId)
      .gte("local_date", since.toISOString().slice(0, 10)),
    s.supabase
      .from("streak_milestones_awarded")
      .select("milestone")
      .eq("user_id", s.userId),
  ]);
  const weeks = buildHeatmap(
    today,
    new Map((days ?? []).map((d) => [d.local_date, d.completed_count])),
  );
  const badges = [...new Set((milestones ?? []).map((m) => m.milestone))].sort(
    (a, b) => a - b,
  );
  const lv = levelProgress(profile.lifetime_points);
  const name = profile.display_name || profile.username;

  return (
    <>
      <Card className="flex flex-col items-center gap-3 py-6 text-center">
        <Avatar
          layers={layers}
          size={128}
          label={`${profile.username}'s avatar`}
        />
        <div>
          <p className="text-xl font-bold" data-testid="profile-name">
            <DisplayName
              name={name}
              colorClass={nameColor}
              styleClass={nameStyle}
            />
          </p>
          <p className="text-muted">@{profile.username}</p>
          {title ? (
            <p className="text-cyan mt-1 text-sm font-semibold">{title}</p>
          ) : null}
        </div>
        <dl className="grid w-full grid-cols-4 gap-2 pt-2">
          {[
            ["Level", lv.level],
            ["Streak", profile.current_streak],
            ["Best", profile.longest_streak],
            ["Freezes", profile.streak_freezes],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface-2 rounded-xl p-2">
              <dt className="text-muted text-xs">{k}</dt>
              <dd className="text-lg font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted w-full text-xs">
          {lv.current.toLocaleString("en-US")} /{" "}
          {lv.needed.toLocaleString("en-US")} XP to level {lv.level + 1}
        </p>
        <Button asChild className="w-full">
          <Link href="/shop">Customize in the shop</Link>
        </Button>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold tracking-wider uppercase">
          Activity
        </h2>
        <Heatmap weeks={weeks} />
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold tracking-wider uppercase">
          Milestones
        </h2>
        {badges.length ? (
          <ul className="flex flex-wrap gap-2">
            {badges.map((m) => (
              <li
                key={m}
                className="border-cyan/50 text-cyan rounded-full border px-3 py-1 text-sm font-semibold"
              >
                {m}-day streak
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">
            Reach a 3-day streak to earn your first badge.
          </p>
        )}
      </Card>
    </>
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
