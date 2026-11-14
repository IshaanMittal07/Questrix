import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDED_COOKIE } from "@/lib/supabase/proxy";

/** POST-only so a link prefetch or <img> can't sign the user out. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  res.cookies.delete(ONBOARDED_COOKIE);
  return res;
}
