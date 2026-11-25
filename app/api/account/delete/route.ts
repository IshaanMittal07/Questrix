import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ONBOARDED_COOKIE } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

/**
 * Deletes the signed-in account (plan §6.6). POST and same-origin only, and
 * the form must repeat the username, so neither CSRF nor a stray tap can do
 * it. The user comes from verified claims, never from the request body.
 * Deleting the auth user cascades to the profile and everything it owns.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, request.url)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const form = await request.formData().catch(() => null);
  const confirm = String(form?.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();
  if (!profile || confirm !== String(profile.username).toLowerCase()) {
    return NextResponse.redirect(
      new URL("/settings?delete=confirm", request.url),
      { status: 303 },
    );
  }

  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.redirect(
      new URL("/settings?delete=failed", request.url),
      { status: 303 },
    );
  }
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login?deleted=1", request.url), {
    status: 303,
  });
  res.cookies.delete(ONBOARDED_COOKIE);
  return res;
}
