import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * A request-scoped Supabase client plus the signed-in user's id, taken from
 * verified claims (getClaims checks the JWT; getSession doesn't), or null
 * when signed out.
 */
export async function getVerifiedUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}
