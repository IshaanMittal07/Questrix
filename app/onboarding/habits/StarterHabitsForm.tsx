"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { addStarterHabits } from "@/lib/habits/actions";
import {
  CATEGORY_LABELS,
  REASON_LABELS,
  type SuggestionView,
} from "@/lib/habits/display";
import {
  getTemplate,
  HABIT_TEMPLATES,
  type HabitCategory,
  type HabitTemplate,
} from "@/lib/habits/templates";

const STARTER_MAX = 3;

/**
 * Onboarding step 2: pick up to 3 starter habits from the library, or skip.
 * Only template keys go to the server, which builds every field itself.
 */
export function StarterHabitsForm({
  suggestions,
}: {
  suggestions: SuggestionView[];
}) {
  const router = useRouter();
  const id = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const full = picked.length >= STARTER_MAX;

  const suggestedKeys = new Set(suggestions.map((s) => s.key));
  const others = HABIT_TEMPLATES.filter((t) => !suggestedKeys.has(t.key));

  function toggle(key: string) {
    setError("");
    setPicked((p) =>
      p.includes(key)
        ? p.filter((k) => k !== key)
        : p.length < STARTER_MAX
          ? [...p, key]
          : p,
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || picked.length === 0) return;
    startTransition(async () => {
      const res = await addStarterHabits(picked);
      if (res.ok) router.push("/today");
      else setError(res.error);
    });
  }

  const option = (t: HabitTemplate, detail?: string) => {
    const checked = picked.includes(t.key);
    // At 3, the rest can't be picked: say why instead of silently ignoring.
    const blocked = full && !checked;
    return (
      <li key={t.key}>
        <label
          className={cn(
            "bg-surface has-[:focus-visible]:outline-cyan flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 has-[:focus-visible]:outline-2",
            checked ? "border-cyan" : "border-white/8",
            blocked && "cursor-not-allowed opacity-50",
          )}
        >
          <input
            type="checkbox"
            checked={checked}
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? `${id}-count` : undefined}
            onChange={() => {
              if (!blocked) toggle(t.key);
            }}
            className="accent-cyan size-5 shrink-0"
          />
          <span aria-hidden="true" className="text-xl">
            {t.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.title}</span>
            {detail ? (
              <span className="text-muted block text-sm">{detail}</span>
            ) : null}
          </span>
        </label>
      </li>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <p
        id={`${id}-count`}
        role="status"
        aria-live="polite"
        className="text-muted text-sm"
      >
        {picked.length === 0
          ? `Pick up to ${STARTER_MAX}. Starting small makes streaks easier to keep.`
          : full
            ? `${STARTER_MAX} of ${STARTER_MAX} picked. Unpick one to choose another.`
            : `${picked.length} of ${STARTER_MAX} picked.`}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-bold">Suggested for you</legend>
        <ul className="flex flex-col gap-2">
          {suggestions.map((s) => {
            const t = getTemplate(s.key);
            return t ? option(t, REASON_LABELS[s.reasons[0]]) : null;
          })}
        </ul>
      </fieldset>

      <details>
        <summary className="text-cyan min-h-11 cursor-pointer py-2 text-sm font-semibold">
          More habits
        </summary>
        <div className="mt-2 flex flex-col gap-4">
          {(Object.keys(CATEGORY_LABELS) as HabitCategory[]).map((c) => {
            const list = others.filter((t) => t.category === c);
            if (list.length === 0) return null;
            return (
              <fieldset key={c} className="flex flex-col gap-2">
                <legend className="text-muted mb-1 text-xs font-semibold tracking-widest uppercase">
                  {CATEGORY_LABELS[c]}
                </legend>
                <ul className="flex flex-col gap-2">
                  {list.map((t) => option(t))}
                </ul>
              </fieldset>
            );
          })}
        </div>
      </details>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          disabled={pending || picked.length === 0}
        >
          {pending
            ? "Adding…"
            : picked.length === 0
              ? "Pick a habit to add"
              : `Add ${picked.length} habit${picked.length === 1 ? "" : "s"}`}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/today">Skip for now</Link>
        </Button>
      </div>
    </form>
  );
}
