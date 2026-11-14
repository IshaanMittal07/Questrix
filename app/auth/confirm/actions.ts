"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Only the type our email templates issue (sign-in and sign-up confirmation). */
const ALLOWED_TYPES: EmailOtpType[] = ["email"];

/**
 * Verifies an email link's token hash. POST-only, so link scanners can't burn it.
 * No `next` parameter: our templates never set one, and a fixed destination
 * leaves nothing to abuse as an open redirect.
 */
export async function confirmEmailLink(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  const rawType = formData.get("type");
  const type = ALLOWED_TYPES.find((t) => t === rawType);

  if (typeof tokenHash === "string" && tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      // Pick the final destination here: a server-action redirect that the
      // proxy redirects again would render /onboarding under the /today URL.
      const userId = data.user?.id;
      const { data: profile } = userId
        ? await supabase
            .from("profiles")
            .select("onboarded_at")
            .eq("id", userId)
            .maybeSingle()
        : { data: null };
      redirect(profile && !profile.onboarded_at ? "/onboarding" : "/today");
    }
  }
  redirect("/login?error=link");
}
