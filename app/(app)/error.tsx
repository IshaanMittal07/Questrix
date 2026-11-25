"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** In-app error boundary: the tab bar stays, so the user can move on. */
export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-lg font-bold">Something went wrong</h1>
      <p className="text-muted text-sm">
        Your points and streaks are safe. Try again, or head back to Today.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button asChild variant="secondary">
          <Link href="/today">Go to Today</Link>
        </Button>
      </div>
    </Card>
  );
}
