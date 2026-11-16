import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { supabaseEnv } from "./env";
import {
  routeBeforeProfile,
  routeForOnboarding,
  type RouteDecision,
} from "./routing";

/** Cookie remembering that onboarding is done (saves a DB read per request). */
export const ONBOARDED_COOKIE = "qx-onboarded";

/**
 * Refreshes the Supabase session cookie on every request and gates routes:
 * signed-out → /login; signed-in but not onboarded → /onboarding.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the JWT (do not trust getSession() on the server).
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const { pathname } = request.nextUrl;

  const redirect = (to: string) => {
    const target = request.nextUrl.clone();
    target.pathname = to;
    target.search = "";
    const res = NextResponse.redirect(target);
    // Keep any refreshed auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  const apply = (decision: RouteDecision) => {
    if (decision.kind === "next") return response;
    const res = redirect(decision.to);
    if (decision.clearOnboarded) res.cookies.delete(ONBOARDED_COOKIE);
    return res;
  };

  const first = routeBeforeProfile(Boolean(userId), pathname);
  if (first !== "check-onboarding") return apply(first);
  if (!userId) return response; // unreachable: only signed-in users get here

  // Onboarding gate. The cookie is a per-user cache, so it stores the user id.
  let onboarded: boolean | "unknown" =
    request.cookies.get(ONBOARDED_COOKIE)?.value === userId;
  if (!onboarded) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", userId)
      .maybeSingle();
    // A failed lookup isn't "not onboarded": routeForOnboarding won't bounce.
    onboarded = error ? "unknown" : Boolean(profile?.onboarded_at);
    if (onboarded === true) {
      response.cookies.set(ONBOARDED_COOKIE, userId, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }

  return apply(routeForOnboarding(onboarded, pathname));
}
