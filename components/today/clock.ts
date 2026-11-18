import { useMemo, useSyncExternalStore } from "react";

/**
 * "Now" for undo deadlines, updated only when one of `deadlines` passes: one
 * timeout to the next deadline, so an idle screen never re-renders. The
 * server render (and hydration) sees 0, so every deadline counts as still
 * open there, and the client corrects it right after. The server re-checks
 * the window anyway (QX104).
 */
// The last time read in subscribe or a timeout. New stores (after every
// tap) start from it, so only true hydration sees 0 and expired Undo
// buttons don't flash for a frame.
let lastNow = 0;

export function useDeadlineClock(deadlines: string[]) {
  const key = deadlines.join(",");
  const store = useMemo(() => {
    const times = key ? key.split(",").map(Date.parse) : [];
    // No Date.now() during render: start from the last known time.
    let current = lastNow;
    return {
      getSnapshot: () => current,
      subscribe(onChange: () => void) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
          const t = Date.now();
          const next = Math.min(...times.filter((d) => d > t));
          if (!Number.isFinite(next)) return;
          timer = setTimeout(
            () => {
              current = lastNow = Date.now();
              onChange();
              arm();
            },
            next - t + 1,
          );
        };
        // Catch up on time that passed before subscribing (hydration); React
        // re-reads the snapshot after subscribing.
        current = lastNow = Date.now();
        arm();
        return () => clearTimeout(timer);
      },
    };
  }, [key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0);
}
