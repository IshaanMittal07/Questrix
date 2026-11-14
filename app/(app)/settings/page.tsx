import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getMyProfile } from "@/lib/profile/queries";
import { TimezoneForm } from "./TimezoneForm";

export const metadata: Metadata = { title: "Settings" };

async function SettingsContent() {
  const me = await getMyProfile();
  if (!me) return null;
  return (
    <>
      <Card>
        <TimezoneForm current={me.profile.timezone} />
      </Card>
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">@{me.profile.username}</p>
          <p className="text-muted text-sm">Signed in</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
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
