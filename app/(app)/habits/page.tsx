import type { Metadata } from "next";
import { Suspense } from "react";

import { HabitList } from "@/components/habits/HabitList";
import { Card } from "@/components/ui/Card";
import { toListItem } from "@/lib/habits/form-data";
import { listActiveHabits, listArchivedHabits } from "@/lib/habits/queries";

export const metadata: Metadata = { title: "Habits" };

async function HabitsContent() {
  const [active, archived] = await Promise.all([
    listActiveHabits(),
    listArchivedHabits(),
  ]);
  return (
    <HabitList
      active={active.map(toListItem)}
      archived={archived.map(toListItem)}
    />
  );
}

export default function HabitsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-wider uppercase">Habits</h1>
      <Suspense fallback={<Card className="h-40 animate-pulse" />}>
        <HabitsContent />
      </Suspense>
    </div>
  );
}
