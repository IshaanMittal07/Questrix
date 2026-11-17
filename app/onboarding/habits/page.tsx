import type { Metadata } from "next";
import { Suspense } from "react";

import { suggestionsForMe } from "@/lib/habits/form-data";
import { StarterHabitsForm } from "./StarterHabitsForm";

export const metadata: Metadata = { title: "Pick your habits" };

async function StarterHabitsData() {
  // For a new user every category and slot is empty, so this ranks the
  // library by the plan's priority (health, mind, fitness first).
  const suggestions = await suggestionsForMe();
  return <StarterHabitsForm suggestions={suggestions} />;
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
