"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  activeRegistration,
  claimSubscription,
  isSubscribed,
  subscribe,
  unsubscribe,
} from "@/lib/push/client";
import { pushSupport, type PushSupport } from "@/lib/push/platform";
import { InstallSheet } from "./InstallSheet";

type State =
  | { kind: "checking" }
  | { kind: "support"; support: Exclude<PushSupport, "supported"> }
  /** Supported, but no service worker is running (yet): try again later. */
  | { kind: "unavailable" }
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
  dismissed: "No problem. You can turn them on any time.",
  "rate-limited": "Too many tries. Try again in a little while.",
} as const;

/** How long the first check waits for the service worker to start. */
const DETECT_TIMEOUT_MS = 5_000;

/** What this device can do right now, plus a note to show (client only). */
async function detect(
  publicKey: string | undefined,
): Promise<{ state: State; note?: string }> {
  const support = pushSupport(
    window as unknown as Parameters<typeof pushSupport>[0],
  );
  if (support !== "supported") return { state: { kind: "support", support } };
  if (Notification.permission === "denied")
    return { state: { kind: "denied" } };
  // No worker (a dev build, a failed or still-installing registration).
  if (!(await activeRegistration(DETECT_TIMEOUT_MS))) {
    return { state: { kind: "unavailable" } };
  }
  if (!(await isSubscribed())) return { state: { kind: "off" } };
  // On means on for whoever is signed in now (security audit of PR #99, S2).
  const claim = await claimSubscription(publicKey);
  if (claim === "stale") {
    return {
      state: { kind: "off" },
      note: "Notifications need turning on again on this device.",
    };
  }
  if (claim === "failed") {
    return {
      state: { kind: "on" },
      note: "Couldn't link this device's notifications to your account. Turn them off and on again.",
    };
  }
  // "none": the subscription vanished between the two checks.
  if (claim === "none") return { state: { kind: "off" } };
  return { state: { kind: "on" } };
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
  // Read by the re-check: an action in progress owns the state and message.
  const busyRef = useRef(false);
  // Bumped when an action starts: a check begun before it is stale.
  const actionSeq = useRef(0);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const run = () => {
      if (busyRef.current) return;
      const seq = actionSeq.current;
      void detect(publicKey).then(({ state: next, note }) => {
        if (!live || busyRef.current || seq !== actionSeq.current) return;
        setState(next);
        // A fresh check replaces any earlier note.
        setMessage(note ?? null);
      });
    };
    run();
    // The worker may finish installing after the first check.
    const sw =
      typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.addEventListener("controllerchange", run);
    return () => {
      live = false;
      sw?.removeEventListener("controllerchange", run);
    };
  }, [publicKey]);

  if (state.kind === "checking") {
    return <p className="text-muted text-sm">Checking notifications…</p>;
  }
  if (state.kind === "support" && state.support === "install") {
    return <InstallSheet />;
  }
  if (state.kind === "unavailable") {
    return <p className="text-muted text-sm">{MESSAGES.unavailable}</p>;
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
    actionSeq.current += 1;
    setBusy(true);
    setMessage(null);
    const res = await subscribe(publicKey);
    setBusy(false);
    if (res.ok) {
      setState({ kind: "on" });
      setMessage("Notifications are on for this device.");
    } else {
      if (res.reason === "denied") setState({ kind: "denied" });
      // A dismissed prompt leaves the state off (it isn't blocked).
      setMessage(MESSAGES[res.reason]);
    }
  }

  async function turnOff() {
    actionSeq.current += 1;
    setBusy(true);
    setMessage(null);
    const ok = await unsubscribe();
    // Say what actually happened: the browser may still be subscribed.
    const stillOn = !ok && (await isSubscribed());
    setBusy(false);
    setState({ kind: stillOn ? "on" : "off" });
    setMessage(
      ok
        ? "Notifications are off for this device."
        : stillOn
          ? "Couldn't turn notifications off. Try again."
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
