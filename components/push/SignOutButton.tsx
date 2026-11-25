"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { clearOfflinePages } from "@/lib/offline/pages";
import { unsubscribe } from "@/lib/push/client";

function noopSubscribe() {
  return () => {};
}

/** Give up on the unsubscribe after this long; sign-out must not hang. */
const UNSUBSCRIBE_TIMEOUT_MS = 3000;

/**
 * Sign out, first forgetting this device's push subscription while the
 * session is still valid (DECISIONS P1): otherwise a shared device would
 * keep showing the previous user's habits on its lock screen.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  // Disabled until hydrated: before then the plain form would post without
  // forgetting the device first. (False on the server, true on the client.)
  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  // Back from the bfcache after a sign-out (or a refused one): usable again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    // In parallel: drop the offline copy of Today, which holds this user's
    // data (DECISIONS H11, capped at 1 s), and unsubscribe this device.
    const pending: Promise<unknown>[] = [clearOfflinePages()];
    if ("serviceWorker" in navigator && "PushManager" in window) {
      pending.push(
        Promise.race([
          unsubscribe(),
          new Promise((r) => setTimeout(r, UNSUBSCRIBE_TIMEOUT_MS)),
        ]),
      );
    }
    await Promise.all(pending);
    form.submit();
  }

  return (
    <form action="/auth/signout" method="post" onSubmit={onSubmit}>
      <Button type="submit" variant="secondary" disabled={busy || !ready}>
        Sign out
      </Button>
    </form>
  );
}
