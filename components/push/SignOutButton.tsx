"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { unsubscribe } from "@/lib/push/client";

/** Give up on the unsubscribe after this long; sign-out must not hang. */
const UNSUBSCRIBE_TIMEOUT_MS = 3000;

/**
 * Sign out, first forgetting this device's push subscription while the
 * session is still valid (DECISIONS P1): otherwise a shared device would
 * keep showing the previous user's habits on its lock screen.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    if ("serviceWorker" in navigator && "PushManager" in window) {
      await Promise.race([
        unsubscribe(),
        new Promise((r) => setTimeout(r, UNSUBSCRIBE_TIMEOUT_MS)),
      ]);
    }
    form.submit();
  }

  return (
    <form action="/auth/signout" method="post" onSubmit={onSubmit}>
      <Button type="submit" variant="secondary" disabled={busy}>
        Sign out
      </Button>
    </form>
  );
}
