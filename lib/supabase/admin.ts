import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Service-role client: bypasses RLS. Only for server jobs with no user
 * session (the reminders cron), plus one user-facing exception: account
 * deletion (app/api/account/delete), which needs auth.admin.deleteUser and
 * takes the user only from verified claims. Never import it from a page, any
 * other Server Action or route that acts for a user, or anything a client
 * bundle can reach.
 */
export function createAdminClient() {
  const { url } = supabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
