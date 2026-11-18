import "server-only";

import { cache } from "react";

import { getVerifiedUser } from "@/lib/supabase/session";
import { todaySchema, type Today } from "@/lib/today/types";

export type TodayLoad =
  | { ok: true; today: Today }
  | { ok: false; reason: "signed_out" | "not_onboarded" | "failed" };

/** One round trip for the whole Today screen (get_today, plan §6.4). */
export const getToday = cache(async (): Promise<TodayLoad> => {
  const s = await getVerifiedUser();
  if (!s) return { ok: false, reason: "signed_out" };
  return loadToday(s.supabase);
});

type RpcClient = NonNullable<
  Awaited<ReturnType<typeof getVerifiedUser>>
>["supabase"];

export async function loadToday(supabase: RpcClient): Promise<TodayLoad> {
  const { data, error } = await supabase.rpc("get_today");
  if (error) {
    if (error.code === "28000") return { ok: false, reason: "signed_out" };
    if (error.code === "QX107") return { ok: false, reason: "not_onboarded" };
    return { ok: false, reason: "failed" };
  }
  const parsed = todaySchema.safeParse(data);
  return parsed.success
    ? { ok: true, today: parsed.data }
    : { ok: false, reason: "failed" };
}
