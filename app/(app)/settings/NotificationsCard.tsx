"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { EnableNotifications } from "@/components/push/EnableNotifications";
import { Switch } from "@/components/ui/Switch";
import { setHabitReminders } from "@/lib/habits/actions";
import { setNotificationPrefs } from "./actions";

export type ReminderHabit = {
  id: string;
  title: string;
  icon: string | null;
  reminderTimes: string[];
  remindersEnabled: boolean;
};

type Prefs = { push_enabled: boolean; streak_saver_enabled: boolean };

/** "08:00" from "08:00:00". */
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Settings → Notifications (plan §12 Phase 5): this device, the global
 * switch, the streak saver, and each habit's reminders. Changes save at
 * once, optimistically; a failure rolls back and says so.
 */
export function NotificationsCard({
  prefs,
  habits,
}: {
  prefs: Prefs;
  habits: ReminderHabit[];
}) {
  const [saved, setSaved] = useState(prefs);
  // Reducers, so saves in flight together each keep their own change.
  const [optimistic, patchOptimistic] = useOptimistic(
    saved,
    (s: Prefs, patch: Partial<Prefs>) => ({ ...s, ...patch }),
  );
  const [habitState, setHabitState] = useState(habits);
  const [optimisticHabits, patchHabit] = useOptimistic(
    habitState,
    (hs: ReminderHabit[], p: { id: string; value: boolean }) =>
      hs.map((h) => (h.id === p.id ? { ...h, remindersEnabled: p.value } : h)),
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function setPref(key: keyof Prefs, value: boolean) {
    setError(null);
    startTransition(async () => {
      patchOptimistic({ [key]: value });
      const res = await setNotificationPrefs({ [key]: value }).catch(() => ({
        ok: false as const,
        error: "Couldn't save. Try again.",
      }));
      if (res.ok) setSaved((s) => ({ ...s, [key]: value }));
      else setError(res.error);
    });
  }

  function setHabit(id: string, value: boolean) {
    setError(null);
    startTransition(async () => {
      patchHabit({ id, value });
      const res = await setHabitReminders(id, value).catch(() => ({
        ok: false as const,
        error: "Couldn't save. Try again.",
      }));
      if (res.ok) {
        setHabitState((hs) =>
          hs.map((h) => (h.id === id ? { ...h, remindersEnabled: value } : h)),
        );
      } else {
        setError(res.error);
      }
    });
  }

  const withTimes = optimisticHabits.filter((h) => h.reminderTimes.length > 0);
  const off = !optimistic.push_enabled;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Notifications</h2>
        <p className="text-muted text-sm">
          Reminders for your habits, on the devices you turn them on for.
        </p>
      </div>

      <EnableNotifications />

      <Switch
        id="push-enabled"
        label="Habit reminders"
        description="Pause every reminder at once, on all your devices."
        checked={optimistic.push_enabled}
        onCheckedChange={(v) => setPref("push_enabled", v)}
      />
      <Switch
        id="streak-saver"
        label="Streak saver"
        description="A nudge at 20:00 when a streak of 3+ days is at risk."
        checked={optimistic.streak_saver_enabled}
        disabled={off}
        onCheckedChange={(v) => setPref("streak_saver_enabled", v)}
      />

      <section
        aria-labelledby="habit-reminders"
        className="flex flex-col gap-2"
      >
        <h3 id="habit-reminders" className="text-sm font-semibold">
          Per habit
        </h3>
        {withTimes.length === 0 ? (
          <p className="text-muted text-sm">
            None of your habits has a reminder time yet. Add one when you{" "}
            <Link href="/habits" className="text-cyan underline">
              edit a habit
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {withTimes.map((h) => (
              <li key={h.id}>
                <Switch
                  id={`habit-${h.id}`}
                  label={`${h.icon ? `${h.icon} ` : ""}${h.title}`}
                  description={h.reminderTimes.map(hhmm).join(", ")}
                  checked={h.remindersEnabled}
                  disabled={off}
                  onCheckedChange={(v) => setHabit(h.id, v)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p role="alert" className="text-danger text-sm empty:hidden">
        {error}
      </p>
    </div>
  );
}
