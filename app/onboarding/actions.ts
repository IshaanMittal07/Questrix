"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { timezoneSchema, usernameSchema } from "@/lib/validation/profile";

const onboardingSchema = z.object({
  username: usernameSchema,
  timezone: timezoneSchema,
  avatarBaseId: z.uuid(),
});

export type OnboardingState = { error?: string; field?: "username" | "form" };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = onboardingSchema.safeParse({
    username: formData.get("username"),
    timezone: formData.get("timezone"),
    avatarBaseId: formData.get("avatarBaseId"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue.message,
      field: issue.path[0] === "username" ? "username" : "form",
    };
  }
  const { username, timezone, avatarBaseId } = parsed.data;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: available } = await supabase.rpc("username_available", {
    p_username: username,
  });
  if (!available) {
    return {
      error: "That username is taken — try another.",
      field: "username",
    };
  }

  // Equip first: if the username write fails, the user can simply retry.
  const { error: equipError } = await supabase.rpc("equip_item", {
    p_slot: "avatar_base",
    p_item_id: avatarBaseId,
  });
  if (equipError) return { error: "Couldn't save your avatar.", field: "form" };

  const { error } = await supabase
    .from("profiles")
    .update({ username, timezone })
    .eq("id", userId);
  if (error) {
    return error.code === "23505"
      ? {
          error: "That username was just taken — try another.",
          field: "username",
        }
      : { error: "Couldn't save your profile. Try again.", field: "form" };
  }

  redirect("/today");
}
