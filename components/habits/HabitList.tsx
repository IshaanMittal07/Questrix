"use client";

import Link from "next/link";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  archiveHabit,
  reorderHabits,
  unarchiveHabit,
} from "@/lib/habits/actions";
import type { Habit } from "@/lib/habits/queries";
import { describeDays } from "@/lib/habits/schedule";
import { cn } from "@/lib/cn";
import { HABIT_LIMITS } from "@/lib/validation/habit";

export type HabitListItem = Pick<
  Habit,
  | "id"
  | "title"
  | "icon"
  | "color"
  | "days_of_week"
  | "target_per_day"
  | "reminder_times"
  | "reminders_enabled"
>;

export const ACCENT_BORDER: Record<string, string> = {
  cyan: "border-l-cyan",
  violet: "border-l-violet",
  magenta: "border-l-magenta",
  success: "border-l-success",
  warning: "border-l-warning",
};

type Change = { type: "order"; ids: string[] } | { type: "remove"; id: string };

function applyChange(list: HabitListItem[], change: Change) {
  if (change.type === "remove") return list.filter((h) => h.id !== change.id);
  const byId = new Map(list.map((h) => [h.id, h]));
  return change.ids.flatMap((id) => byId.get(id) ?? []);
}

function summary(h: HabitListItem) {
  const parts = [describeDays(h.days_of_week)];
  if (h.target_per_day > 1) parts.push(`${h.target_per_day}× a day`);
  if (h.reminders_enabled && h.reminder_times.length > 0) {
    parts.push(h.reminder_times.map((t) => t.slice(0, 5)).join(", "));
  }
  return parts.join(" · ");
}

/**
 * The habits list: reorder (optimistic, with keyboard move up/down buttons
 * rather than drag only), archive, restore, and Add (disabled at the cap).
 * Moves and errors are announced in live regions.
 */
export function HabitList({
  active,
  archived,
}: {
  active: HabitListItem[];
  archived: HabitListItem[];
}) {
  const [items, change] = useOptimistic(active, applyChange);
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const atCap = items.length >= HABIT_LIMITS.activeMax;

  // Keep focus on the moved habit's button, or its sibling once disabled.
  useEffect(() => {
    const want = focusAfter.current;
    if (!want || !listRef.current) return;
    focusAfter.current = null;
    const find = (dir: string) =>
      listRef.current?.querySelector<HTMLButtonElement>(
        `[data-move="${want.id}:${dir}"]:not(:disabled)`,
      );
    (find(want.dir) ?? find(want.dir === "up" ? "down" : "up"))?.focus();
  }, [items]);

  function move(index: number, dir: "up" | "down") {
    const to = dir === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= items.length) return;
    const ids = items.map((h) => h.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    const title = items[index].title;
    focusAfter.current = { id: items[index].id, dir };
    setError("");
    setStatus(`${title} moved to position ${to + 1} of ${ids.length}.`);
    startTransition(async () => {
      change({ type: "order", ids });
      const res = await reorderHabits(ids);
      if (!res.ok) setError(res.error);
    });
  }

  function archive(h: HabitListItem) {
    setError("");
    setStatus(`${h.title} archived.`);
    startTransition(async () => {
      change({ type: "remove", id: h.id });
      const res = await archiveHabit(h.id);
      if (!res.ok) setError(res.error);
    });
  }

  function restore(h: HabitListItem) {
    setError("");
    startTransition(async () => {
      const res = await unarchiveHabit(h.id);
      if (res.ok) setStatus(`${h.title} restored.`);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {atCap ? (
        <div className="flex flex-col gap-1">
          <Button disabled aria-describedby="habit-cap-note">
            Add habit
          </Button>
          <p id="habit-cap-note" className="text-muted text-center text-sm">
            You have {HABIT_LIMITS.activeMax} active habits, the most allowed.
            Archive one to add another.
          </p>
        </div>
      ) : (
        <Button asChild>
          <Link href="/habits/new">Add habit</Link>
        </Button>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <p className="text-muted">
            No habits yet. Add one, or start from a template.
          </p>
        </Card>
      ) : (
        <ol
          ref={listRef}
          aria-label="Your habits"
          className="flex flex-col gap-2"
        >
          {items.map((h, i) => (
            <li key={h.id}>
              <Card
                className={cn(
                  "flex items-center gap-3 border-l-4 py-3",
                  (h.color && ACCENT_BORDER[h.color]) || "border-l-white/10",
                )}
              >
                <span aria-hidden="true" className="w-7 text-center text-xl">
                  {h.icon ?? "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/habits/${h.id}/edit`}
                    className="block truncate font-semibold underline-offset-4 hover:underline"
                  >
                    {h.title}
                    <span className="sr-only">, edit</span>
                  </Link>
                  <p className="text-muted truncate text-sm">{summary(h)}</p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    data-move={`${h.id}:up`}
                    aria-label={`Move ${h.title} up`}
                    disabled={i === 0}
                    onClick={() => move(i, "up")}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-move={`${h.id}:down`}
                    aria-label={`Move ${h.title} down`}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, "down")}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Archive ${h.title}`}
                    onClick={() => archive(h)}
                  >
                    <span aria-hidden="true">✕</span>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 ? (
        <details className="group">
          <summary className="text-muted min-h-11 cursor-pointer py-2 text-sm font-semibold">
            Archived ({archived.length})
          </summary>
          <ul aria-label="Archived habits" className="mt-2 flex flex-col gap-2">
            {archived.map((h) => (
              <li key={h.id}>
                <Card className="flex items-center gap-3 py-3 opacity-80">
                  <span aria-hidden="true" className="w-7 text-center text-xl">
                    {h.icon ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <Button
                    variant="secondary"
                    aria-label={`Restore ${h.title}`}
                    disabled={atCap}
                    onClick={() => restore(h)}
                  >
                    Restore
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
