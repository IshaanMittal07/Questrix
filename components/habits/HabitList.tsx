"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  archiveHabit,
  reorderHabits,
  unarchiveHabit,
} from "@/lib/habits/actions";
import { ACCENT_BORDER, type HabitListItem } from "@/lib/habits/display";
import { HABIT_LIMITS } from "@/lib/habits/limits";
import { describeDays } from "@/lib/habits/schedule";

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

/** Where focus goes after the list changes. */
type FocusTarget =
  | { kind: "move"; id: string; dir: "up" | "down" }
  | { kind: "habit"; id: string }
  | { kind: "add" };

/**
 * The habits list: reorder (optimistic, with keyboard move up/down buttons
 * rather than drag), archive, restore, and Add (unavailable at the cap, with
 * the reason). Moves and errors are announced, and focus never falls back
 * to the page after a control disappears.
 */
export function HabitList({
  active,
  archived,
}: {
  active: HabitListItem[];
  archived: HabitListItem[];
}) {
  const router = useRouter();
  const capNoteId = useId();
  const [items, change] = useOptimistic(active, applyChange);
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<FocusTarget | null>(null);
  const atCap = items.length >= HABIT_LIMITS.activeMax;

  useEffect(() => {
    const want = focusAfter.current;
    const root = rootRef.current;
    if (!want || !root) return;
    const q = (sel: string) =>
      root.querySelector<HTMLElement>(`${sel}:not(:disabled)`);
    let el: HTMLElement | null = null;
    if (want.kind === "move") {
      el =
        q(`[data-move="${want.id}:${want.dir}"]`) ??
        q(`[data-move="${want.id}:${want.dir === "up" ? "down" : "up"}"]`);
    } else if (want.kind === "habit") {
      el = q(`[data-edit="${want.id}"]`);
    } else {
      el = q("[data-add]");
    }
    // A restored habit appears only after the server refresh: keep waiting.
    if (!el && want.kind === "habit") return;
    focusAfter.current = null;
    el?.focus();
  }, [items]);

  function move(index: number, dir: "up" | "down") {
    const to = dir === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= items.length) return;
    const ids = items.map((h) => h.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    const title = items[index].title;
    focusAfter.current = { kind: "move", id: items[index].id, dir };
    setError("");
    setStatus(`${title} moved to position ${to + 1} of ${ids.length}.`);
    startTransition(async () => {
      change({ type: "order", ids });
      const res = await reorderHabits(ids);
      if (res.ok) return;
      setStatus(`Couldn't move ${title}. The order was restored.`);
      setError(res.error);
      // Another tab changed the list: fetch the current one.
      if (res.code === "stale") router.refresh();
    });
  }

  function archive(index: number) {
    const h = items[index];
    const neighbour = items[index + 1] ?? items[index - 1];
    focusAfter.current = neighbour
      ? { kind: "habit", id: neighbour.id }
      : { kind: "add" };
    setError("");
    setStatus(`${h.title} archived.`);
    startTransition(async () => {
      change({ type: "remove", id: h.id });
      const res = await archiveHabit(h.id);
      if (!res.ok) setError(res.error);
    });
  }

  function restore(h: HabitListItem) {
    if (atCap || restoring) return;
    setError("");
    setRestoring(h.id);
    // Set before the await: the refreshed list may commit as soon as it lands.
    focusAfter.current = { kind: "habit", id: h.id };
    startTransition(async () => {
      try {
        const res = await unarchiveHabit(h.id);
        if (res.ok) {
          setStatus(`${h.title} restored.`);
        } else {
          focusAfter.current = null;
          setError(res.error);
        }
      } finally {
        setRestoring(null);
      }
    });
  }

  // Rendered by Add and again under the archived list; only the first copy
  // carries the id that both controls reference.
  const capNote = (withId: boolean) => (
    <p
      id={withId ? capNoteId : undefined}
      className="text-muted text-center text-sm"
    >
      You have {HABIT_LIMITS.activeMax} active habits, the most allowed. Archive
      one to add or restore another.
    </p>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {atCap ? (
        <div className="flex flex-col gap-1">
          {/* aria-disabled keeps it focusable, so the reason can be heard. */}
          <Button
            data-add
            aria-disabled="true"
            aria-describedby={capNoteId}
            className="opacity-50"
          >
            Add habit
          </Button>
          {capNote(true)}
        </div>
      ) : (
        <Button asChild>
          <Link href="/habits/new" data-add>
            Add habit
          </Link>
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
        <ol aria-label="Your habits" className="flex flex-col gap-2">
          {items.map((h, i) => (
            <li key={h.id}>
              <Card
                className={cn(
                  "flex items-center gap-3 border-l-4 py-3",
                  // The column holds any string; unknown values get the neutral border.
                  (h.color &&
                    (ACCENT_BORDER as Record<string, string | undefined>)[
                      h.color
                    ]) ||
                    "border-l-white/10",
                )}
              >
                <span aria-hidden="true" className="w-7 text-center text-xl">
                  {h.icon ?? "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/habits/${h.id}/edit`}
                    data-edit={h.id}
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
                    onClick={() => archive(i)}
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
        <details>
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
                    aria-disabled={atCap || restoring !== null || undefined}
                    aria-describedby={atCap ? capNoteId : undefined}
                    className={cn(
                      (atCap || restoring !== null) && "opacity-50",
                    )}
                    onClick={() => restore(h)}
                  >
                    {restoring === h.id ? "Restoring…" : "Restore"}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
          {atCap ? capNote(false) : null}
        </details>
      ) : null}
    </div>
  );
}
