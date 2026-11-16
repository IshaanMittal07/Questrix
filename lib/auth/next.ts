import { HOME_PATH } from "@/lib/supabase/routing";
import { safeNextPath } from "@/lib/validation/path";

/** The validated `?next=` from a login URL's query string (home if absent or unsafe). */
export function nextFromSearch(search: string) {
  return safeNextPath(new URLSearchParams(search).get("next"), HOME_PATH);
}

/**
 * The OAuth / email-link landing URL. `next` rides along as a query param;
 * /auth/callback re-checks it with safeNextPath before redirecting.
 */
export function authCallbackUrl(origin: string, next: string) {
  const url = new URL("/auth/callback", origin);
  if (next !== HOME_PATH) url.searchParams.set("next", next);
  return url.toString();
}
