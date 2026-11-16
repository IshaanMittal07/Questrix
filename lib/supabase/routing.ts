/**
 * Pure route-gating rules used by proxy.ts (kept free of Next/Supabase imports
 * so they can be unit-tested). Pages and server actions still enforce access
 * on their own; this only decides where to send the browser.
 */

export const PUBLIC_PATHS = ["/login", "/auth"] as const;
export const ONBOARDING_PATH = "/onboarding";
export const HOME_PATH = "/today";

export type RouteDecision =
  { kind: "next" } | { kind: "redirect"; to: string; clearOnboarded?: boolean };

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * First step, before any profile lookup. Returns "check-onboarding" when the
 * answer depends on whether the signed-in user has finished onboarding.
 */
export function routeBeforeProfile(
  signedIn: boolean,
  pathname: string,
): RouteDecision | "check-onboarding" {
  if (!signedIn) {
    return isPublicPath(pathname)
      ? { kind: "next" }
      : { kind: "redirect", to: "/login", clearOnboarded: true };
  }
  if (pathname === "/login") return { kind: "redirect", to: HOME_PATH };
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
