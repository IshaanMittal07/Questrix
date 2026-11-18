import { useMemo, useSyncExternalStore } from "react";

/**
 * "Now" for undo deadlines, updated only when one of `deadlines` passes: one
 * timeout to the next deadline, so an idle screen never re-renders. The
 * server render (and hydration) sees 0, so every deadline counts as still
 * open there, and the client corrects it right after. The server re-checks
 * the window anyway (QX104).
 */
export function useDeadlineClock(deadlines: string[]) {
  const key = deadlines.join(",");
  const store = useMemo(() => {
    const times = key ? key.split(",").map(Date.parse) : [];
    let current = Date.now();
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
              current = Date.now();
              onChange();
              arm();
            },
            next - t + 1,
          );
        };
        // Catch up on time that passed before subscribing (hydration); React
        // re-reads the snapshot after subscribing.
        current = Date.now();
        arm();
        return () => clearTimeout(timer);
      },
    };
  }, [key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0);
}
