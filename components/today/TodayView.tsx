"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { ACCENT_BORDER } from "@/lib/habits/display";
import { levelProgress } from "@/lib/points/levels";
import {
  completeHabit,
  undoCompletion,
  type TodayErrorCode,
} from "@/lib/today/actions";
import type { Today, TodayCompletion, TodayHabit } from "@/lib/today/types";

import { useDeadlineClock } from "./clock";
import { Confetti } from "./Confetti";

type Pending =
  | { type: "complete"; habitId: string }
  | { type: "undo"; completionId: string };

const PENDING_PREFIX = "pending:";

/** The optimistic view while a complete or undo is in flight. */
export function applyPending(today: Today, p: Pending): Today {
  return {
    ...today,
    habits: today.habits.map((h) => {
      if (p.type === "complete") {
        if (h.id !== p.habitId || h.done >= h.target) return h;
        const occurrence = h.done + 1;
        return {
          ...h,
          done: occurrence,
          completions: [
            ...h.completions,
            {
              id: `${PENDING_PREFIX}${occurrence}`,
              occurrence,
              points_awarded: 0,
              completed_at: "",
              undoable_until: "",
            },
          ],
        };
      }
      if (!h.completions.some((c) => c.id === p.completionId)) return h;
      return {
        ...h,
        done: Math.max(0, h.done - 1),
        completions: h.completions.filter((c) => c.id !== p.completionId),
      };
    }),
  };
}

/** The latest completion of a habit that can still be undone, if any. */
export function undoable(
  h: TodayHabit,
  now: number,
): TodayCompletion | undefined {
  const last = h.completions.at(-1);
  if (!last || last.id.startsWith(PENDING_PREFIX)) return undefined;
  // now = 0 before hydration: show it; the server re-checks the window.
  return now === 0 || Date.parse(last.undoable_until) > now ? last : undefined;
}

/** Refusals from the action, plus two the client adds around the call. */
type ErrorCode = TodayErrorCode | "offline" | "unreachable";

// The screen may be out of date: fetch the real state. "unreachable" too,
// because a lost response can hide a write that committed.
const STALE: ErrorCode[] = [
  "not_found",
  "not_today",
  "done",
  "too_late",
  "unreachable",
];

type Float = { key: number; habitId: string; text: string };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const OFFLINE = "You're offline. Reconnect to save your progress.";

/** Calls a server action; a network failure becomes a refusal, never a throw. */
async function reach<T>(
  call: () => Promise<T>,
): Promise<T | { ok: false; code: ErrorCode; error: string }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, code: "offline", error: OFFLINE };
  }
  try {
    return await call();
  } catch {
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    return {
      ok: false,
      code: "unreachable",
      // Not "try again": the write may have landed; the refresh will show it.
      error: offline ? OFFLINE : "Couldn't confirm that saved. Checking…",
    };
  }
}

/** The date (YYYY-MM-DD, like local_date) and hour now in `timezone`. */
function localNow(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      hour: Number(get("hour")),
    };
  } catch {
    return null;
  }
}

/** The hour get_today starts reporting at_risk (DECISIONS D7). */
const AT_RISK_HOUR = 18;
const REFRESH_EVERY_MS = 60_000;

function vibrate() {
  try {
    // iOS Safari has no vibrate; that's fine (plan §8).
    navigator.vibrate?.(15);
  } catch {
    // Some browsers throw without a user gesture.
  }
}

/**
 * The Today screen: header (streak flame, points, level ring), the at-risk
 * banner, and a big tappable card per habit with progress pips. Completing is
 * optimistic, then the action's fresh get_today replaces the view; undo
 * appears on a card while its latest completion is inside the window.
 */
export function TodayView({
  today: fromServer,
  avatar,
}: {
  today: Today;
  avatar?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();

  // The latest snapshot: from the server render, or from the last action.
  // A new server render (navigation, refresh) replaces it.
  const [base, setBase] = useState({ from: fromServer, today: fromServer });
  if (base.from !== fromServer)
    setBase({ from: fromServer, today: fromServer });

  const [today, addPending] = useOptimistic(base.today, applyPending);
  const now = useDeadlineClock(
    today.habits.flatMap((h) => {
      const last = h.completions.at(-1);
      return last && !last.id.startsWith(PENDING_PREFIX)
        ? [last.undoable_until]
        : [];
    }),
  );
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [floats, setFloats] = useState<Float[]>([]);
  const [confetti, setConfetti] = useState(0);
  const floatKey = useRef(0);

  // With cacheComponents the route is hidden (Activity), not unmounted, when
  // the user navigates away: don't bring back an old message or animation.
  useLayoutEffect(
    () => () => {
      setError("");
      setStatus("");
      setFloats([]);
      setConfetti(0);
    },
    [],
  );

  // Roll over at local midnight, and pick up at_risk at 18:00: a PWA left
  // open must not keep showing an old snapshot. Checked each minute and
  // whenever the app comes back. Throttled rather than once-only, so a
  // device clock that runs fast, or a refresh that fails, is retried until
  // the server's snapshot catches up.
  const { local_date: shownDate, local_hour: shownHour, timezone } = base.today;
  useEffect(() => {
    let last = -Infinity;
    const check = () => {
      // A hidden tab catches up on visibilitychange instead.
      if (document.visibilityState !== "visible") return;
      const n = localNow(timezone);
      if (!n) return;
      // Only when the device is ahead of the snapshot. YYYY-MM-DD sorts as a
      // date; a device clock that runs slow must not refresh every minute.
      const behind =
        n.date > shownDate ||
        (n.date === shownDate &&
          shownHour < AT_RISK_HOUR &&
          n.hour >= AT_RISK_HOUR);
      if (behind && Date.now() - last >= REFRESH_EVERY_MS) {
        last = Date.now();
        router.refresh();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = setInterval(check, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [shownDate, shownHour, timezone, router]);

  useEffect(() => {
    if (!confetti) return;
    const t = setTimeout(() => setConfetti(0), 2_500);
    return () => clearTimeout(t);
  }, [confetti]);

  function adopt(next: Today | null) {
    if (next) {
      startTransition(() => setBase((b) => ({ from: b.from, today: next })));
    } else {
      router.refresh();
    }
  }

  function showFloat(habitId: string, text: string) {
    const key = ++floatKey.current;
    setFloats((f) => [...f, { key, habitId, text }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 1_200);
  }

  function complete(h: TodayHabit) {
    if (h.done >= h.target) return;
    setError("");
    vibrate();
    startTransition(async () => {
      addPending({ type: "complete", habitId: h.id });
      const res = await reach(() => completeHabit(h.id));
      if (!res.ok) {
        // A double tap that raced the first one (or a completion from
        // another device): not an error, just say so politely.
        if (res.code === "done") {
          setStatus(`${h.title} is already done for today.`);
        } else {
          setError(res.error);
          setStatus(`Couldn't complete ${h.title}.`);
        }
        if (STALE.includes(res.code)) router.refresh();
        return;
      }
      const e = res.event;
      if (!e) {
        setStatus(`${h.title} saved.`);
        adopt(res.today);
        return;
      }
      showFloat(
        h.id,
        e.multiplier > 1
          ? `+${e.points_awarded} ×${e.multiplier.toFixed(2)}`
          : `+${e.points_awarded}`,
      );
      const streak = res.today?.current_streak ?? e.current_streak;
      let msg = `${h.title}: ${e.occurrence} of ${e.target} done. +${e.points_awarded} points. ${streak}-day streak.`;
      if (e.milestone !== null) {
        msg += ` ${e.milestone}-day milestone, +${e.milestone_points ?? 0} bonus points!`;
        setConfetti((c) => c + 1);
        toast({
          title: `${e.milestone}-day streak!`,
          description: `+${e.milestone_points ?? 0} bonus points`,
          tone: "success",
        });
      }
      setStatus(msg);
      adopt(res.today);
    });
  }

  function undo(h: TodayHabit, c: TodayCompletion) {
    setError("");
    startTransition(async () => {
      addPending({ type: "undo", completionId: c.id });
      const res = await reach(() => undoCompletion(c.id));
      if (!res.ok) {
        setError(res.error);
        setStatus(`Couldn't undo ${h.title}.`);
        if (STALE.includes(res.code)) router.refresh();
        return;
      }
      const e = res.event;
      let msg = `Undid ${h.title}.`;
      if (e) {
        const lost = e.points_removed + e.milestone_points_removed;
        msg += ` −${plural(lost, "point")}.`;
        const revoked = e.milestones_revoked ?? [];
        if (revoked.length > 0) {
          msg += ` ${revoked.map((m) => `${m}-day`).join(", ")} milestone removed.`;
        }
      }
      if (res.today) msg += ` ${res.today.current_streak}-day streak.`;
      setStatus(msg);
      adopt(res.today);
    });
  }

  const { level, current, needed } = levelProgress(today.lifetime_points);
  const name = today.display_name || today.username;
  const doneCount = today.habits.filter((h) => h.done >= h.target).length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-4">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="text-muted text-sm">Welcome back,</p>
          <p className="truncate text-lg font-bold">{name}</p>
          <p className="flex flex-wrap items-center gap-x-3 text-sm">
            <span
              data-testid="streak"
              className={cn(
                "inline-flex items-center gap-1 font-semibold",
                today.current_streak > 0 ? "text-warning" : "text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  today.current_streak > 0 && "qx-flame",
                  today.current_streak === 0 && "grayscale",
                )}
              >
                🔥
              </span>
              {plural(today.current_streak, "day")}
              <span className="sr-only"> streak</span>
            </span>
            <span data-testid="balance" className="text-muted">
              {today.points_balance.toLocaleString("en")} pts
            </span>
            {today.streak_freezes > 0 ? (
              <span className="text-cyan">
                <span aria-hidden="true">❄️</span>{" "}
                {plural(today.streak_freezes, "freeze")}
              </span>
            ) : null}
          </p>
        </div>
        <ProgressRing
          value={current}
          max={needed}
          label={`Level ${level} progress`}
          valueText={`Level ${level}: ${current} of ${needed} points to the next level`}
        >
          {level}
        </ProgressRing>
      </Card>

      {today.at_risk ? (
        <AtRiskBanner
          streak={today.current_streak}
          empty={today.habits.length === 0}
        />
      ) : null}
      {today.freezes_needed > 0 && today.current_streak > 0 ? (
        <p className="text-cyan text-sm">
          Your next completion uses{" "}
          {plural(today.freezes_needed, "streak freeze")} to keep your streak.
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {today.habits.length === 0 ? (
        today.at_risk ? null : (
          <Card className="flex flex-col items-start gap-3">
            <p className="text-muted">
              {today.scheduled_count === 0
                ? "Rest day: nothing is scheduled today."
                : "Nothing left to show today."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/habits/new">Add a habit</Link>
              </Button>
              {today.scheduled_count > 0 ? (
                <Button asChild variant="secondary">
                  <Link href="/habits">Restore a habit</Link>
                </Button>
              ) : null}
            </div>
          </Card>
        )
      ) : (
        <section aria-labelledby="today-habits" className="flex flex-col gap-2">
          <h2 id="today-habits" className="text-muted text-sm font-semibold">
            {doneCount} of {today.habits.length} done
          </h2>
          <ul className="flex flex-col gap-2">
            {today.habits.map((h) => (
              <li key={h.id}>
                <HabitCard
                  habit={h}
                  undoTarget={undoable(h, now)}
                  floats={floats.filter((f) => f.habitId === h.id)}
                  onComplete={() => complete(h)}
                  onUndo={(c) => undo(h, c)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {confetti ? <Confetti key={confetti} /> : null}
    </div>
  );
}

function AtRiskBanner({ streak, empty }: { streak: number; empty: boolean }) {
  return (
    <Card
      data-testid="at-risk"
      className="border-warning/60 flex flex-col gap-2 border"
    >
      <p className="font-semibold">
        <span aria-hidden="true">⚠️</span> Your {plural(streak, "day")} streak
        is at risk
      </p>
      {empty ? (
        <>
          <p className="text-muted text-sm">
            Today&apos;s habits were archived. Add or restore a habit and
            complete it before midnight to keep your streak.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/habits/new">Add a habit</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/habits">Restore a habit</Link>
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted text-sm">
          Complete any habit before midnight to keep it.
        </p>
      )}
    </Card>
  );
}

function HabitCard({
  habit: h,
  undoTarget,
  floats,
  onComplete,
  onUndo,
}: {
  habit: TodayHabit;
  undoTarget: TodayCompletion | undefined;
  floats: Float[];
  onComplete: () => void;
  onUndo: (c: TodayCompletion) => void;
}) {
  const done = h.done >= h.target;
  const progress = `${h.done} of ${h.target}`;
  const accent =
    h.color && Object.hasOwn(ACCENT_BORDER, h.color)
      ? ACCENT_BORDER[h.color as keyof typeof ACCENT_BORDER]
      : "border-l-white/10";

  // When Undo disappears (used, or its window closed) while focused, keep
  // keyboard and screen-reader users on this card instead of <body>.
  const mainRef = useRef<HTMLButtonElement>(null);
  const undoFocused = useRef(false);
  useEffect(() => {
    if (undoTarget || !undoFocused.current) return;
    undoFocused.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) mainRef.current?.focus();
  }, [undoTarget]);

  return (
    <Card
      data-habit={h.id}
      className={cn(
        "relative flex items-center gap-2 border-l-4 p-0 transition-colors",
        accent,
        done && "bg-surface-2",
      )}
    >
      <button
        ref={mainRef}
        type="button"
        onClick={onComplete}
        aria-disabled={done || undefined}
        aria-label={
          (done
            ? `${h.title}, done for today`
            : `Complete ${h.title}, ${progress} done`) +
          (h.habit_streak > 0
            ? `, ${plural(h.habit_streak, "day")} streak`
            : "")
        }
        className={cn(
          "flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99]",
          done && "cursor-default",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full text-xl",
            done ? "bg-success/20 qx-pop" : "bg-white/5",
          )}
        >
          {done ? "✓" : (h.icon ?? "•")}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-semibold",
              done && "text-muted line-through decoration-2",
            )}
          >
            {h.title}
          </span>
          <span
            aria-hidden="true"
            className="text-muted flex items-center gap-2 text-sm"
          >
            {h.target > 1 ? (
              <span className="flex gap-1" data-testid="pips">
                {Array.from({ length: h.target }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-2.5 rounded-full",
                      i < h.done ? "bg-success" : "bg-white/15",
                    )}
                  />
                ))}
              </span>
            ) : null}
            {h.target > 1 ? <span>{progress}</span> : null}
            {h.habit_streak > 0 ? <span>🔥 {h.habit_streak}</span> : null}
          </span>
        </span>
      </button>
      {undoTarget ? (
        <Button
          variant="ghost"
          className="mr-2 shrink-0"
          aria-label={`Undo ${h.title}`}
          onFocus={() => {
            undoFocused.current = true;
          }}
          onBlur={(e) => {
            // relatedTarget is null when the button is removed while focused.
            if (e.relatedTarget) undoFocused.current = false;
          }}
          onClick={() => {
            onUndo(undoTarget);
            mainRef.current?.focus();
          }}
        >
          Undo
        </Button>
      ) : null}
      {floats.map((f) => (
        <span
          key={f.key}
          aria-hidden="true"
          className="qx-float text-success pointer-events-none absolute top-2 right-4 font-bold"
        >
          {f.text}
        </span>
      ))}
    </Card>
  );
}
