"use server";

import { revalidatePath } from "next/cache";
import { DEADLOCK, RETRY_MESSAGE, serverMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { timezoneSchema } from "@/lib/validation/profile";
import { z } from "zod";

export type SettingsState = { ok?: boolean; error?: string };

export async function updateTimezone(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = timezoneSchema.safeParse(formData.get("timezone"));
  if (!parsed.success) return { error: "Pick a valid timezone." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "You're signed out." };

  const { error } = await supabase
    .from("profiles")
    .update({ timezone: parsed.data })
    .eq("id", userId);
  if (error) {
    // 22023: this browser knows the zone, but the server's tz database doesn't.
    if (error.code === "22023") return { error: "Pick a valid timezone." };
    // QX001: the once-a-week cooldown (#28); the message and hint are ours.
    if (error.code === "QX001") {
      return { error: serverMessage(error.message, error.hint) };
    }
    if (error.code === DEADLOCK) return { error: RETRY_MESSAGE };
    return { error: "Couldn't save. Try again." };
  }

  revalidatePath("/settings");
  return { ok: true };
}

const notificationPrefsSchema = z
  .object({
    push_enabled: z.boolean().optional(),
    streak_saver_enabled: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0);

export type PrefsResult = { ok: true } | { ok: false; error: string };

/**
 * Turn reminders or the streak saver on or off for the signed-in user
 * (plan §12 Phase 5). Only these two columns are client-writable (P3).
 */
export async function setNotificationPrefs(
  input: unknown,
): Promise<PrefsResult> {
  const parsed = notificationPrefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save. Try again." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, error: "You're signed out." };

  const { data, error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("id", userId)
    .select("id");
  if (error) {
    if (error.code === DEADLOCK) return { ok: false, error: RETRY_MESSAGE };
    return { ok: false, error: "Couldn't save. Try again." };
  }
  // No row changed (no profile, or RLS): nothing was saved.
  if (!data || data.length === 0) {
    return { ok: false, error: "Couldn't save. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}
