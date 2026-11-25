import type { Metadata } from "next";
import Link from "next/link";
import { EnableNotifications } from "@/components/push/EnableNotifications";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HOME_PATH } from "@/lib/supabase/routing";

export const metadata: Metadata = { title: "Stay on track" };

/**
 * Onboarding step 3 (plan §7.1, §12 Phase 5): offer reminders, skippable.
 * The proxy gates it like any onboarding page; permission is asked only
 * inside the tap (EnableNotifications).
 */
export default function NotificationsStepPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div>
        <p className="text-cyan text-sm font-semibold tracking-widest uppercase">
          Step 3
        </p>
        <h1 className="mt-1 text-2xl font-bold">Stay on track</h1>
        <p className="text-muted mt-1">
          Get a reminder when a habit is due, and a heads-up at 20:00 when a
          streak is at risk. You can change this anytime in Settings.
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
