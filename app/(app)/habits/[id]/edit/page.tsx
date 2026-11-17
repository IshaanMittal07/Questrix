import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { HabitForm } from "@/components/habits/HabitForm";
import { Card } from "@/components/ui/Card";
import { coachingContext, toFormValues } from "@/lib/habits/form-data";
import { getMyHabit } from "@/lib/habits/queries";

export const metadata: Metadata = { title: "Edit habit" };

async function EditHabitContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [habit, coaching] = await Promise.all([
    getMyHabit(id),
    coachingContext(id.toLowerCase()),
  ]);
  if (!habit) notFound();
  return (
    <HabitForm
      mode="edit"
      habitId={habit.id}
      initial={toFormValues(habit)}
      coaching={coaching}
    />
  );
}

export default function EditHabitPage(props: PageProps<"/habits/[id]/edit">) {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/habits"
        className="text-muted min-h-11 self-start py-2 text-sm"
      >
        ← Habits
      </Link>
      <h1 className="text-2xl font-bold tracking-wider uppercase">
        Edit habit
      </h1>
      {/* params are runtime data under cacheComponents: read them in Suspense. */}
      <Suspense fallback={<Card className="h-80 animate-pulse" />}>
        <EditHabitContent params={props.params} />
      </Suspense>
    </div>
  );
}
