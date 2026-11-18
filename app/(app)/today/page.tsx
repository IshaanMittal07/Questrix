import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar/Avatar";
import { TodayView } from "@/components/today/TodayView";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getMyProfile } from "@/lib/profile/queries";
import { getToday } from "@/lib/today/queries";

export const metadata: Metadata = { title: "Today" };

async function TodayContent() {
  const [loaded, me] = await Promise.all([getToday(), getMyProfile()]);

  if (!loaded.ok) {
    if (loaded.reason === "not_onboarded") {
      return (
        <Card className="flex flex-col items-start gap-3">
          <p>Finish setting up your account to start tracking.</p>
          <Button asChild>
            <Link href="/onboarding">Continue setup</Link>
          </Button>
        </Card>
      );
    }
    return (
      <Card role="alert">
        <p className="text-danger">
          {loaded.reason === "signed_out"
            ? "You're signed out."
            : "Couldn't load today. Reload the page, or try again shortly."}
        </p>
      </Card>
    );
  }

  return (
    <TodayView
      today={loaded.today}
      avatar={
        me ? (
          <Avatar
            layers={me.layers}
            size={64}
            label={`${me.profile.username}'s avatar`}
          />
        ) : null
      }
    />
  );
}

export default function TodayPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Today</h1>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4" aria-busy="true">
            <Card className="h-24 animate-pulse" />
            <Card className="h-16 animate-pulse" />
            <Card className="h-16 animate-pulse" />
          </div>
        }
      >
        <TodayContent />
      </Suspense>
    </div>
  );
}
