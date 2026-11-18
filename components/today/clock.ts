import { useSyncExternalStore } from "react";

/**
 * A coarse shared clock for undo deadlines. The server render (and
 * hydration) sees 0, so every undoable_until counts as still open there,
 * and the client corrects it right after. The server re-checks the window
 * anyway (QX104), so this only hides buttons that would be refused.
 */
const TICK_MS = 5_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Rounded so repeated reads within a tick return the same value.
const snapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverSnapshot = () => 0;

export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
