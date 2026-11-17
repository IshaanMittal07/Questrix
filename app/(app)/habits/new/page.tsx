import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { HabitForm } from "@/components/habits/HabitForm";
import { Card } from "@/components/ui/Card";
import { coachingContext, suggestionsForMe } from "@/lib/habits/form-data";

export const metadata: Metadata = { title: "Add habit" };

async function NewHabitContent() {
  const [suggestions, coaching] = await Promise.all([
    suggestionsForMe(),
    coachingContext(),
  ]);
  return (
    <HabitForm mode="create" suggestions={suggestions} coaching={coaching} />
  );
}

export default function NewHabitPage() {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/habits"
        className="text-muted min-h-11 self-start py-2 text-sm"
      >
        ← Habits
      </Link>
      <h1 className="text-2xl font-bold tracking-wider uppercase">Add habit</h1>
      <Suspense fallback={<Card className="h-80 animate-pulse" />}>
        <NewHabitContent />
      </Suspense>
    </div>
  );
}
