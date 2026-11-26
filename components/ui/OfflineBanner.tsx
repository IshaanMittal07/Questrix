"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Shown while the device is offline (plan §9). Pages may be the last copy the
 * service worker kept, and nothing can be saved: completions are never
 * queued, because the server is authoritative.
 */
export function OfflineBanner() {
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  return (
    <p
      role="status"
      data-testid="offline-banner"
      className={
        offline
          ? "bg-warning text-bg sticky top-0 z-40 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-center text-sm font-semibold"
          : "sr-only"
      }
    >
      {offline
        ? "You're offline. This may be your last saved view, and changes won't save until you reconnect."
        : ""}
    </p>
  );
}
