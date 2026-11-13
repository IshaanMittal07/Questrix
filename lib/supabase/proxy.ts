import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { supabaseEnv } from "./env";

/** Cookie remembering that onboarding is done (saves a DB read per request). */
export const ONBOARDED_COOKIE = "qx-onboarded";

const PUBLIC_PATHS = ["/login", "/auth"];
const ONBOARDING_PATH = "/onboarding";

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

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

  if (!userId) {
    if (isPublic(pathname)) return response;
    response.cookies.delete(ONBOARDED_COOKIE);
    const res = redirect("/login");
    res.cookies.delete(ONBOARDED_COOKIE);
    return res;
  }

  if (isPublic(pathname) && pathname === "/login") return redirect("/today");
  if (isPublic(pathname)) return response;

  // Onboarding gate. The cookie is a per-user cache, so it stores the user id.
  let onboarded = request.cookies.get(ONBOARDED_COOKIE)?.value === userId;
  if (!onboarded) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", userId)
      .maybeSingle();
    onboarded = Boolean(profile?.onboarded_at);
    if (onboarded) {
      response.cookies.set(ONBOARDED_COOKIE, userId, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }

  if (!onboarded && pathname !== ONBOARDING_PATH)
    return redirect(ONBOARDING_PATH);
  if (onboarded && pathname === ONBOARDING_PATH) return redirect("/today");
  return response;
}
