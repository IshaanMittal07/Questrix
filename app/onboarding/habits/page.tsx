import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { suggestionsForMe } from "@/lib/habits/form-data";
import { listActiveHabits, listArchivedHabits } from "@/lib/habits/queries";
import { getMyProfile } from "@/lib/profile/queries";
import { ONBOARDING_PATH } from "@/lib/supabase/routing";
import { StarterHabitsForm } from "./StarterHabitsForm";

export const metadata: Metadata = { title: "Pick your habits" };

async function StarterHabitsData() {
  // The proxy already gates this page, but it lets requests through when
  // its profile lookup fails: check step 1 here too.
  // Only bounce on a known answer: null means the lookup failed (or, never in
  // practice, the signup trigger didn't create the row).
  const me = await getMyProfile();
  if (me && !me.profile.onboarded_at) redirect(ONBOARDING_PATH);

  // For a new user every category and slot is empty, so this ranks the
  // library by the plan's priority (health, mind, fitness first).
  const [suggestions, active, archived] = await Promise.all([
    suggestionsForMe(),
    listActiveHabits(),
    listArchivedHabits(),
  ]);
  // The archived list is capped (ARCHIVED_LIST_MAX); a template archived
  // longer ago may be offered again, which the server cap tolerates.
  const ownedKeys = [...active, ...archived].flatMap((h) =>
    h.template_key ? [h.template_key] : [],
  );
  return <StarterHabitsForm suggestions={suggestions} ownedKeys={ownedKeys} />;
}

export default function StarterHabitsPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div>
        <p className="text-cyan text-sm font-semibold tracking-widest uppercase">
          Step 2
        </p>
        <h1 className="mt-1 text-2xl font-bold">Choose your first quests</h1>
        <p className="text-muted mt-1">
          Pick up to 3 habits to start with. You can change them anytime.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <StarterHabitsData />
      </Suspense>
    </main>
  );
}
