/**
 * Browser capability checks for push (plan §7.1). Pure, with the globals
 * injected, so they're unit-testable.
 */

type Nav = {
  userAgent: string;
  maxTouchPoints?: number;
  platform?: string;
  standalone?: boolean;
};

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(nav: Nav) {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** Opened from the Home Screen (installed), not in a browser tab. */
export function isStandalone(
  nav: Nav,
  matchMedia: (q: string) => { matches: boolean },
) {
  return (
    matchMedia("(display-mode: standalone)").matches || nav.standalone === true
  );
}

export type PushSupport =
  /** Ready to ask for permission. */
  | "supported"
  /** iOS Safari in a tab: push only works in the installed app (16.4+). */
  | "install"
  /** No service worker, PushManager or Notification here. */
  | "unsupported";

export function pushSupport(win: {
  navigator: Nav & { serviceWorker?: unknown };
  matchMedia: (q: string) => { matches: boolean };
  PushManager?: unknown;
  Notification?: unknown;
}): PushSupport {
  const nav = win.navigator;
  if (isIOS(nav) && !isStandalone(nav, win.matchMedia)) return "install";
  if (!nav.serviceWorker || !win.PushManager || !win.Notification) {
    return "unsupported";
  }
  return "supported";
}
