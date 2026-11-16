/**
 * Pure route-gating rules used by proxy.ts (kept free of Next/Supabase imports
 * so they can be unit-tested). Pages and server actions still enforce access
 * on their own; this only decides where to send the browser.
 */

import { safeNextPath } from "@/lib/validation/path";

export const LOGIN_PATH = "/login";
export const PUBLIC_PATHS = [LOGIN_PATH, "/auth"] as const;
export const ONBOARDING_PATH = "/onboarding";
export const HOME_PATH = "/today";
const MAX_NEXT_LENGTH = 512;

export type RouteDecision =
  { kind: "next" } | { kind: "redirect"; to: string; clearOnboarded?: boolean };

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Where to send a signed-out visitor: /login, carrying the page they asked for
 * as `?next=` so sign-in can return them there. Home needs no `next` (it's the
 * default), and anything safeNextPath would reject is dropped, not forwarded.
 */
export function loginPathFor(pathname: string, search = "") {
  const next = `${pathname}${search}`;
  // "/" is already redirected to /today by next.config.ts; kept for safety.
  if (next === "/" || next === HOME_PATH) return LOGIN_PATH;
  // It's copied into Location and then Supabase's redirect_to: keep it short.
  if (next.length > MAX_NEXT_LENGTH) return LOGIN_PATH;
  if (safeNextPath(next, "") !== next) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

/**
 * First step, before any profile lookup. Returns "check-onboarding" when the
 * answer depends on whether the signed-in user has finished onboarding.
 */
export function routeBeforeProfile(
  signedIn: boolean,
  pathname: string,
  search = "",
): RouteDecision | "check-onboarding" {
  if (!signedIn) {
    return isPublicPath(pathname)
      ? { kind: "next" }
      : {
          kind: "redirect",
          to: loginPathFor(pathname, search),
          clearOnboarded: true,
        };
  }
  if (pathname === LOGIN_PATH) {
    // Already signed in (e.g. another tab finished sign-in): honour ?next=.
    const next = new URLSearchParams(search).get("next");
    return { kind: "redirect", to: safeNextPath(next, HOME_PATH) };
  }
  if (isPublicPath(pathname)) return { kind: "next" };
  return "check-onboarding";
}

/** Second step. "unknown" means the profile lookup failed: don't bounce. */
export function routeForOnboarding(
  onboarded: boolean | "unknown",
  pathname: string,
): RouteDecision {
  if (onboarded === "unknown") return { kind: "next" };
  if (!onboarded && pathname !== ONBOARDING_PATH) {
    return { kind: "redirect", to: ONBOARDING_PATH };
  }
  if (onboarded && pathname === ONBOARDING_PATH) {
    return { kind: "redirect", to: HOME_PATH };
  }
  return { kind: "next" };
}
