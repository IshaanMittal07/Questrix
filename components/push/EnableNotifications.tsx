"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isSubscribed, subscribe, unsubscribe } from "@/lib/push/client";
import { pushSupport, type PushSupport } from "@/lib/push/platform";
import { InstallSheet } from "./InstallSheet";

type State =
  | { kind: "checking" }
  | { kind: "support"; support: Exclude<PushSupport, "supported"> }
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "denied" };

const MESSAGES = {
  denied:
    "Notifications are blocked for Questrix. Allow them in your browser or system settings, then try again.",
  unavailable: "Notifications aren't available right now.",
  "too-many":
    "Notifications are on for 10 devices already. Turn them off on one you no longer use.",
  failed: "Couldn't turn notifications on. Try again.",
} as const;

/** What this device can do right now (browser APIs: client only). */
async function detect(): Promise<State> {
  const support = pushSupport(
    window as unknown as Parameters<typeof pushSupport>[0],
  );
  if (support !== "supported") return { kind: "support", support };
  if (Notification.permission === "denied") return { kind: "denied" };
  return { kind: (await isSubscribed()) ? "on" : "off" };
}

/**
 * Turn push on or off for this device. Permission is asked only inside the
 * tap (iOS Safari requires it). On iPhone outside the installed app it
 * explains how to install instead (plan §7.1).
 */
export function EnableNotifications({
  publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
}: {
  publicKey?: string;
}) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void detect().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "checking") {
    return <p className="text-muted text-sm">Checking notifications…</p>;
  }
  if (state.kind === "support" && state.support === "install") {
    return <InstallSheet />;
  }
  if (state.kind === "support") {
    return (
      <p className="text-muted text-sm">
        This browser doesn&apos;t support notifications.
      </p>
    );
  }
  if (!publicKey) {
    return <p className="text-muted text-sm">Notifications are unavailable.</p>;
  }

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const res = await subscribe(publicKey);
    setBusy(false);
    if (res.ok) {
      setState({ kind: "on" });
      setMessage("Notifications are on for this device.");
    } else {
      if (res.reason === "denied") setState({ kind: "denied" });
      setMessage(MESSAGES[res.reason]);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    const ok = await unsubscribe();
    setBusy(false);
    setState({ kind: "off" });
    setMessage(
      ok
        ? "Notifications are off for this device."
        : "Notifications are off here, but the server didn't confirm. Try again later.",
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {state.kind === "on" ? (
        <Button variant="secondary" onClick={turnOff} disabled={busy}>
          Turn off notifications on this device
        </Button>
      ) : (
        <Button onClick={turnOn} disabled={busy}>
          Enable notifications
        </Button>
      )}
      {state.kind === "denied" && !message ? (
        <p className="text-muted text-sm">{MESSAGES.denied}</p>
      ) : null}
      <p role="status" aria-live="polite" className="text-muted text-sm">
        {message}
      </p>
    </div>
  );
}
