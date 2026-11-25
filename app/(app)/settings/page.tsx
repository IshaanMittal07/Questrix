import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/push/SignOutButton";
import { Card } from "@/components/ui/Card";
import { timezoneCooldownUntil } from "@/lib/profile/cooldown";
import { listActiveHabits } from "@/lib/habits/queries";
import { getMyProfile } from "@/lib/profile/queries";
import { createClient } from "@/lib/supabase/server";
import { NotificationsCard } from "./NotificationsCard";
import { TimezoneForm } from "./TimezoneForm";

export const metadata: Metadata = { title: "Settings" };

/** The #28 cooldown, for display; the profiles trigger enforces it. */
async function timezoneLock(profile: {
  timezone: string;
  timezone_changed_at: string | null;
}) {
  if (!profile.timezone_changed_at) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("economy_config")
    .select("value")
    .eq("key", "timezone_change_cooldown_days")
    .maybeSingle();
  const days = Number(data?.value);
  if (!Number.isFinite(days)) return null;
  return timezoneCooldownUntil(
    profile.timezone_changed_at,
    days,
    new Date(),
    profile.timezone,
  );
}

async function SettingsContent() {
  const me = await getMyProfile();
  if (!me) return null;
  const [lockedUntil, habits] = await Promise.all([
    timezoneLock(me.profile),
    // A failure here costs only the per-habit list, not Settings (and
    // Sign out) as a whole.
    listActiveHabits().catch(() => null),
  ]);
  return (
    <>
      <Card>
        <TimezoneForm current={me.profile.timezone} lockedUntil={lockedUntil} />
      </Card>
      <Card>
        <NotificationsCard
          prefs={{
            push_enabled: me.profile.push_enabled,
            streak_saver_enabled: me.profile.streak_saver_enabled,
          }}
          habitsError={habits === null}
          habits={(habits ?? []).map((h) => ({
            id: h.id,
            title: h.title,
            icon: h.icon,
            reminderTimes: h.reminder_times,
            remindersEnabled: h.reminders_enabled,
          }))}
        />
      </Card>
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">@{me.profile.username}</p>
          <p className="text-muted text-sm">Signed in</p>
        </div>
        <SignOutButton />
      </Card>
    </>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Settings</h1>
      <Suspense fallback={<Card className="h-40 animate-pulse" />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
