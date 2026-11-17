"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { addStarterHabits } from "@/lib/habits/actions";
import { CATEGORY_LABELS, type SuggestionView } from "@/lib/habits/display";
import {
  getTemplate,
  HABIT_TEMPLATES,
  type HabitCategory,
  type HabitTemplate,
} from "@/lib/habits/templates";
import { HOME_PATH } from "@/lib/supabase/routing";

const STARTER_MAX = 3;

/**
 * Onboarding step 2: pick up to 3 starter habits from the library, or skip.
 * Only template keys go to the server, which builds every field itself.
 * Templates the user already has (a revisit) aren't offered again.
 */
export function StarterHabitsForm({
  suggestions,
  ownedKeys = [],
}: {
  suggestions: SuggestionView[];
  ownedKeys?: string[];
}) {
  const router = useRouter();
  const id = useId();
  const countId = `${id}-count`;
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const full = picked.length >= STARTER_MAX;
  const none = picked.length === 0;

  const owned = new Set(ownedKeys);
  const suggestedTemplates = suggestions.flatMap((s) => {
    const t = getTemplate(s.key);
    return t && !owned.has(t.key) ? [t] : [];
  });
  const suggestedKeys = new Set(suggestedTemplates.map((t) => t.key));
  const others = HABIT_TEMPLATES.filter(
    (t) => !suggestedKeys.has(t.key) && !owned.has(t.key),
  );

  function toggle(key: string) {
    if (pending) return;
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
    if (pending || none) return;
    startTransition(async () => {
      try {
        const res = await addStarterHabits(picked);
        if (res.ok) router.push(HOME_PATH);
        else setError(res.error);
      } catch {
        // A network drop or server crash: stay here, with Skip available.
        setError("Couldn't add your habits. Try again, or skip for now.");
      }
    });
  }

  const option = (t: HabitTemplate) => {
    const checked = picked.includes(t.key);
    // At 3, the rest can't be picked: say why instead of silently ignoring.
    const blocked = full && !checked;
    const detailId = `${id}-${t.key}`;
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
            aria-disabled={blocked || pending || undefined}
            aria-describedby={blocked ? `${detailId} ${countId}` : detailId}
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
            {/* Visible, but outside the accessible name (aria-hidden here,
                read once through aria-describedby below). */}
            <span aria-hidden="true" className="text-muted block text-sm">
              {CATEGORY_LABELS[t.category]}
            </span>
          </span>
        </label>
        <span id={detailId} className="sr-only">
          {CATEGORY_LABELS[t.category]}
        </span>
      </li>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <p id={countId} role="status" className="text-muted text-sm">
        {none
          ? `Pick up to ${STARTER_MAX}. Starting small makes streaks easier to keep.`
          : full
            ? `${STARTER_MAX} of ${STARTER_MAX} picked. Unpick one to choose another.`
            : `${picked.length} of ${STARTER_MAX} picked.`}
      </p>

      {suggestedTemplates.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-bold">
            Suggested for you
          </legend>
          <ul className="flex flex-col gap-2">
            {suggestedTemplates.map(option)}
          </ul>
        </fieldset>
      ) : null}

      {others.length > 0 ? (
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
                  <ul className="flex flex-col gap-2">{list.map(option)}</ul>
                </fieldset>
              );
            })}
          </div>
        </details>
      ) : null}

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* aria-disabled while nothing is picked: focusable, with a reason. */}
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          aria-disabled={none || undefined}
          aria-describedby={none ? countId : undefined}
          className={cn(none && "opacity-50 active:scale-100")}
        >
          {pending
            ? "Adding…"
            : none
              ? "Pick a habit to add"
              : `Add ${picked.length} habit${picked.length === 1 ? "" : "s"}`}
        </Button>
        <Button
          asChild
          variant="ghost"
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Link
            href={HOME_PATH}
            aria-disabled={pending || undefined}
            onClick={(e) => {
              if (pending) e.preventDefault();
            }}
          >
            Skip for now
          </Link>
        </Button>
      </div>
    </form>
  );
}
