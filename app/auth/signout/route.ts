import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDED_COOKIE } from "@/lib/supabase/proxy";

/**
 * POST-only so a link prefetch or <img> can't sign the user out, and
 * same-origin only so another site can't post a sign-out form (logout CSRF).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.url)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  res.cookies.delete(ONBOARDED_COOKIE);
  return res;
}
