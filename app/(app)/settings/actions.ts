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
  if (error) return { error: "Couldn't save. Try again." };

  revalidatePath("/settings");
  return { ok: true };
}
