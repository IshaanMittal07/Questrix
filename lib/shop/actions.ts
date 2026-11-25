"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SLOTS } from "@/lib/shop/types";
import { DEADLOCK, RETRY_MESSAGE } from "@/lib/supabase/errors";
import { getVerifiedUser } from "@/lib/supabase/session";
import { uuidSchema } from "@/lib/validation/habit";

/**
 * Buy and equip. purchase_item and equip_item do every check (balance, level,
 * ownership, slot, freeze cap) under the profile lock; these only validate
 * input and map SQLSTATEs to copy (D9), never message text.
 */

export type PurchaseResult =
  | { ok: true; balance: number; streakFreezes: number }
  | { ok: false; error: string };
export type EquipResult = { ok: true } | { ok: false; error: string };

const PURCHASE_ERRORS: Record<string, string> = {
  QX201: "You don't have enough points for that yet.",
  QX202: "You already own that.",
  QX203: "Reach the required level to unlock that.",
  QX204: "You're already holding the most streak freezes.",
  QX107: "Finish setting up your account first.",
  P0002: "That item isn't available.",
  "28000": "You're signed out.",
};

const purchaseEvent = z.object({
  new_balance: z.number().int(),
  streak_freezes: z.number().int(),
});

export async function purchaseItem(itemId: unknown): Promise<PurchaseResult> {
  const id = uuidSchema.safeParse(itemId);
  if (!id.success) return { ok: false, error: "That item isn't available." };
  const s = await getVerifiedUser();
  if (!s) return { ok: false, error: "You're signed out." };

  const { data, error } = await s.supabase.rpc("purchase_item", {
    p_item_id: id.data,
  });
  if (error) {
    if (error.code === DEADLOCK) return { ok: false, error: RETRY_MESSAGE };
    return {
      ok: false,
      error:
        PURCHASE_ERRORS[error.code ?? ""] ?? "Couldn't buy that. Try again.",
    };
  }
  revalidatePath("/shop");
  revalidatePath("/profile");
  revalidatePath("/today");
  const ev = purchaseEvent.safeParse(data);
  if (!ev.success)
    return { ok: false, error: "Bought, but refresh to see it." };
  return {
    ok: true,
    balance: ev.data.new_balance,
    streakFreezes: ev.data.streak_freezes,
  };
}

const equipInput = z.object({
  slot: z.enum(SLOTS),
  itemId: uuidSchema.nullable(),
});

export async function equipItem(
  slot: unknown,
  itemId: unknown,
): Promise<EquipResult> {
  const input = equipInput.safeParse({ slot, itemId });
  if (!input.success) return { ok: false, error: "Couldn't equip that." };
  const s = await getVerifiedUser();
  if (!s) return { ok: false, error: "You're signed out." };

  const { error } = await s.supabase.rpc("equip_item", {
    p_slot: input.data.slot,
    // The generated type says string; equip_item takes null to unequip.
    p_item_id: input.data.itemId as string,
  });
  if (error) {
    if (error.code === "42501")
      return { ok: false, error: "You don't own that." };
    if (error.code === "28000")
      return { ok: false, error: "You're signed out." };
    return { ok: false, error: "Couldn't equip that. Try again." };
  }
  revalidatePath("/shop");
  revalidatePath("/profile");
  return { ok: true };
}
