import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EnableNotifications } from "@/components/push/EnableNotifications";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getMyProfile } from "@/lib/profile/queries";
import { HOME_PATH, ONBOARDING_PATH } from "@/lib/supabase/routing";

export const metadata: Metadata = { title: "Stay on track" };

/**
 * The proxy gates this page, but lets requests through when its profile
 * lookup fails: check step 1 here too, as step 2 does. Only a known answer
 * bounces (null means the lookup failed).
 */
async function Step1Guard() {
  const me = await getMyProfile();
  if (me && !me.profile.onboarded_at) redirect(ONBOARDING_PATH);
  return null;
}

/**
 * Onboarding step 3 (plan §7.1, §12 Phase 5): offer reminders, skippable.
 * Permission is asked only inside the tap (EnableNotifications). The 20:00
 * and 3+ day figures match due_streak_savers
 * (supabase/migrations/20261123000300_due_reminders.sql).
 */
export default function NotificationsStepPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <Suspense fallback={null}>
        <Step1Guard />
      </Suspense>
      <div>
        <p className="text-cyan text-sm font-semibold tracking-widest uppercase">
          Step 3
        </p>
        <h1 className="mt-1 text-2xl font-bold">Stay on track</h1>
        <p className="text-muted mt-1">
          Get a reminder when a habit is due, and a heads-up at 20:00 when a
          streak of 3+ days is at risk. You can change this anytime in Settings.
        </p>
      </div>
      <Card>
        <EnableNotifications />
      </Card>
      <Button asChild>
        <Link href={HOME_PATH}>Continue</Link>
      </Button>
    </main>
  );
}
