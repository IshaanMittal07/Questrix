"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { timezoneSchema } from "@/lib/validation/profile";

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
      return {
        error: `${error.message}.${error.hint ? ` ${error.hint}` : ""}`,
      };
    }
    return { error: "Couldn't save. Try again." };
  }

  revalidatePath("/settings");
  return { ok: true };
}
