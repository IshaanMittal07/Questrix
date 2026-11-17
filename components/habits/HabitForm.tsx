"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { createHabit, updateHabit } from "@/lib/habits/actions";
import { coachingHints, type SuggestionReason } from "@/lib/habits/suggestions";
import {
  getTemplate,
  HABIT_TEMPLATES,
  type HabitCategory,
  type HabitDifficulty,
  type HabitTemplate,
} from "@/lib/habits/templates";
import { HABIT_COLORS, HABIT_LIMITS } from "@/lib/validation/habit";

export const CATEGORY_LABELS: Record<HabitCategory, string> = {
  health: "Health",
  fitness: "Fitness",
  mind: "Mind",
  learning: "Learning",
  career: "Career",
  self_care: "Self-care",
  nutrition: "Nutrition",
  finance: "Finance",
  social: "Social",
  other: "Other",
};

const DIFFICULTIES: { value: HabitDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const COLOR_SWATCH: Record<string, string> = {
  cyan: "bg-cyan",
  violet: "bg-violet",
  magenta: "bg-magenta",
  success: "bg-success",
  warning: "bg-warning",
};

const DAY_NAMES = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const;
// Monday first, as in describeDays.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const REASON_LABELS: Record<SuggestionReason, string> = {
  pair: "Pairs well",
  category_gap: "New area",
  slot_gap: "Fills a gap in your day",
  popular: "Popular with friends",
};

export type HabitFormValues = {
  title: string;
  description: string;
  icon: string;
  category: HabitCategory;
  difficulty: HabitDifficulty;
  color: string | null;
  days_of_week: number[];
  target_per_day: number;
  reminder_times: string[];
  reminders_enabled: boolean;
};

export type SuggestionView = {
  key: string;
  reasons: SuggestionReason[];
  pairedWith?: string;
};

export type CoachingInput = {
  activeHabits: { title: string; reminder_times: string[] }[];
  /** ISO timestamps, from the server so both renders agree. */
  onboardedAt: string | null;
  now: string;
};

const EMPTY: HabitFormValues = {
  title: "",
  description: "",
  icon: "",
  category: "health",
  difficulty: "medium",
  color: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  target_per_day: 1,
  reminder_times: [],
  reminders_enabled: true,
};

function fromTemplate(t: HabitTemplate): HabitFormValues {
  return {
    ...EMPTY,
    title: t.title,
    icon: t.icon,
    category: t.category,
    difficulty: t.difficulty,
    days_of_week: [...t.defaultDays],
    target_per_day: t.targetPerDay,
    reminder_times: [...t.defaultTimes],
    reminders_enabled: t.defaultTimes.length > 0,
  };
}

/** Fields whose errors render next to them. */
const INLINE_ERRORS = new Set([
  "title",
  "icon",
  "description",
  "days_of_week",
  "reminder_times",
]);

const fieldClass =
  "bg-surface-2 text-text min-h-12 w-full rounded-xl border border-white/10 px-3";

type Props =
  | {
      mode: "create";
      suggestions: SuggestionView[];
      coaching: CoachingInput;
      /** Where to go after saving. */
      doneHref?: string;
    }
  | {
      mode: "edit";
      habitId: string;
      initial: HabitFormValues;
      coaching: CoachingInput;
      doneHref?: string;
    };

/**
 * Add/Edit Habit. In create mode a template or suggestion pre-fills the
 * fields and records template_key. Coaching hints are advisory and announced
 * politely; the server validates and enforces everything.
 */
export function HabitForm(props: Props) {
  const router = useRouter();
  const id = useId();
  const fid = (name: string) => `${id}-${name}`;
  const [values, setValues] = useState<HabitFormValues>(
    props.mode === "edit" ? props.initial : EMPTY,
  );
  const [templateKey, setTemplateKey] = useState<string | undefined>();
  const [error, setError] = useState<{ message: string; field?: string }>();
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof HabitFormValues>(
    key: K,
    value: HabitFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const hints = useMemo(
    () =>
      coachingHints(values, {
        activeHabits: props.coaching.activeHabits,
        onboardedAt: props.coaching.onboardedAt
          ? new Date(props.coaching.onboardedAt)
          : null,
        now: new Date(props.coaching.now),
        editing: props.mode === "edit",
      }),
    [values, props.coaching, props.mode],
  );
  const atCap = hints.some((h) => h.kind === "at_cap");

  function pick(t: HabitTemplate) {
    setValues(fromTemplate(t));
    setTemplateKey(t.key);
    setError(undefined);
    setNotice(
      `Filled in from the ${t.title} template. Edit anything you like.`,
    );
    document.getElementById(fid("title"))?.focus();
  }

  function toggleDay(d: number) {
    const has = values.days_of_week.includes(d);
    set(
      "days_of_week",
      has
        ? values.days_of_week.filter((x) => x !== d)
        : [...values.days_of_week, d],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const fields = {
      title: values.title,
      description: values.description || null,
      icon: values.icon || null,
      category: values.category,
      difficulty: values.difficulty,
      color: values.color,
      days_of_week: values.days_of_week,
      target_per_day: values.target_per_day,
      reminder_times: values.reminder_times.filter(Boolean),
      reminders_enabled: values.reminders_enabled,
    };
    startTransition(async () => {
      const res =
        props.mode === "create"
          ? await createHabit(
              templateKey ? { ...fields, template_key: templateKey } : fields,
            )
          : await updateHabit(props.habitId, fields);
      if (res.ok) {
        router.push(props.doneHref ?? "/habits");
        return;
      }
      setError({ message: res.error, field: res.field });
      if (res.field) document.getElementById(fid(res.field))?.focus();
    });
  }

  const errorFor = (field: string) =>
    error?.field === field ? (
      <p id={fid(`${field}-error`)} className="text-danger text-sm">
        {error.message}
      </p>
    ) : null;
  const describedBy = (field: string) =>
    error?.field === field ? fid(`${field}-error`) : undefined;

  const suggested = props.mode === "create" ? props.suggestions : [];

  return (
    <div className="flex flex-col gap-6">
      {props.mode === "create" ? (
        <section
          aria-labelledby={fid("templates")}
          className="flex flex-col gap-3"
        >
          <h2 id={fid("templates")} className="text-base font-bold">
            Start from a template
          </h2>
          {suggested.length > 0 ? (
            <ul aria-label="Suggested for you" className="flex flex-col gap-2">
              {suggested.map((s) => {
                const t = getTemplate(s.key);
                if (!t) return null;
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      aria-pressed={templateKey === t.key}
                      onClick={() => pick(t)}
                      className={cn(
                        "bg-surface flex min-h-12 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left",
                        templateKey === t.key
                          ? "border-cyan"
                          : "border-white/8",
                      )}
                    >
                      <span aria-hidden="true" className="text-xl">
                        {t.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{t.title}</span>
                        <span className="text-muted block text-sm">
                          {s.pairedWith
                            ? `Pairs with ${s.pairedWith}`
                            : REASON_LABELS[s.reasons[0]]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <details>
            <summary className="text-cyan min-h-11 cursor-pointer py-2 text-sm font-semibold">
              Browse all {HABIT_TEMPLATES.length} templates
            </summary>
            <div className="mt-2 flex flex-col gap-4">
              {(Object.keys(CATEGORY_LABELS) as HabitCategory[]).map((c) => {
                const list = HABIT_TEMPLATES.filter((t) => t.category === c);
                if (list.length === 0) return null;
                return (
                  <div key={c}>
                    <h3 className="text-muted mb-1 text-xs font-semibold tracking-widest uppercase">
                      {CATEGORY_LABELS[c]}
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                      {list.map((t) => (
                        <li key={t.key}>
                          <button
                            type="button"
                            aria-pressed={templateKey === t.key}
                            onClick={() => pick(t)}
                            className={cn(
                              "bg-surface-2 min-h-11 rounded-full border px-3 text-sm",
                              templateKey === t.key
                                ? "border-cyan"
                                : "border-white/10",
                            )}
                          >
                            <span aria-hidden="true">{t.icon} </span>
                            {t.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </details>
          <p role="status" aria-live="polite" className="text-muted text-sm">
            {notice}
          </p>
        </section>
      ) : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={fid("title")} className="text-sm font-semibold">
            Name
          </label>
          <input
            id={fid("title")}
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={HABIT_LIMITS.titleMax * 2}
            autoComplete="off"
            aria-invalid={error?.field === "title" || undefined}
            aria-describedby={describedBy("title")}
            className={fieldClass}
            placeholder="e.g. Read 20 pages"
          />
          {errorFor("title")}
        </div>

        <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
          {hints.map((h) => (
            <div
              key={h.kind}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm",
                h.kind === "at_cap" || h.kind === "overload"
                  ? "border-warning/50"
                  : "border-cyan/40",
              )}
            >
              <p>{h.message}</p>
              {h.kind === "stack" ? (
                <p className="text-muted mt-1">{h.stackingCopy}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={fid("icon")} className="text-sm font-semibold">
              Icon
            </label>
            <input
              id={fid("icon")}
              value={values.icon}
              onChange={(e) => set("icon", e.target.value)}
              maxLength={HABIT_LIMITS.iconMax}
              aria-invalid={error?.field === "icon" || undefined}
              aria-describedby={describedBy("icon")}
              className={cn(fieldClass, "text-center text-xl")}
              placeholder="✨"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={fid("category")} className="text-sm font-semibold">
              Category
            </label>
            <select
              id={fid("category")}
              value={values.category}
              onChange={(e) => set("category", e.target.value as HabitCategory)}
              className={fieldClass}
            >
              {(Object.keys(CATEGORY_LABELS) as HabitCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {errorFor("icon")}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Difficulty</legend>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <label
                key={d.value}
                className="bg-surface-2 has-[:checked]:border-cyan has-[:focus-visible]:outline-cyan flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-white/10 text-sm has-[:focus-visible]:outline-2"
              >
                <input
                  type="radio"
                  name={fid("difficulty")}
                  value={d.value}
                  checked={values.difficulty === d.value}
                  onChange={() => set("difficulty", d.value)}
                  className="sr-only"
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend
            id={fid("days_of_week")}
            tabIndex={-1}
            className="mb-1 text-sm font-semibold"
          >
            Days
          </legend>
          <div className="flex justify-between gap-1">
            {DAY_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={values.days_of_week.includes(d)}
                aria-label={DAY_NAMES[d][1]}
                onClick={() => toggleDay(d)}
                className="bg-surface-2 aria-pressed:bg-cyan aria-pressed:text-bg size-11 rounded-full border border-white/10 text-xs font-semibold"
              >
                {DAY_NAMES[d][0].slice(0, 2)}
              </button>
            ))}
          </div>
          {errorFor("days_of_week")}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={fid("target_per_day")}
            className="text-sm font-semibold"
          >
            Times per day
          </label>
          <select
            id={fid("target_per_day")}
            value={values.target_per_day}
            onChange={(e) => set("target_per_day", Number(e.target.value))}
            className={fieldClass}
          >
            {Array.from(
              { length: HABIT_LIMITS.targetMax },
              (_, i) => i + 1,
            ).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Once" : `${n} times`}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend
            id={fid("reminder_times")}
            tabIndex={-1}
            className="mb-1 text-sm font-semibold"
          >
            Reminders
          </legend>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={values.reminders_enabled}
              onChange={(e) => set("reminders_enabled", e.target.checked)}
              className="accent-cyan size-5"
            />
            Remind me
          </label>
          {values.reminder_times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={t}
                aria-label={`Reminder time ${i + 1}`}
                onChange={(e) =>
                  set(
                    "reminder_times",
                    values.reminder_times.map((x, j) =>
                      j === i ? e.target.value : x,
                    ),
                  )
                }
                className={fieldClass}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove reminder time ${i + 1}`}
                onClick={() =>
                  set(
                    "reminder_times",
                    values.reminder_times.filter((_, j) => j !== i),
                  )
                }
              >
                <span aria-hidden="true">✕</span>
              </Button>
            </div>
          ))}
          {values.reminder_times.length < HABIT_LIMITS.remindersMax ? (
            <Button
              variant="secondary"
              onClick={() =>
                set("reminder_times", [...values.reminder_times, "09:00"])
              }
            >
              Add a reminder time
            </Button>
          ) : null}
          {errorFor("reminder_times")}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Colour</legend>
          <div className="flex gap-2">
            {[null, ...HABIT_COLORS].map((c) => (
              <label
                key={c ?? "none"}
                className="has-[:checked]:outline-text has-[:focus-visible]:outline-cyan flex size-11 cursor-pointer items-center justify-center rounded-full outline-offset-2 has-[:checked]:outline-2 has-[:focus-visible]:outline-2"
              >
                <input
                  type="radio"
                  name={fid("color")}
                  checked={values.color === c}
                  onChange={() => set("color", c)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-8 rounded-full border border-white/20",
                    c ? COLOR_SWATCH[c] : "bg-surface-2",
                  )}
                />
                <span className="sr-only">{c ?? "No colour"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={fid("description")} className="text-sm font-semibold">
            Notes <span className="text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id={fid("description")}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={HABIT_LIMITS.descriptionMax * 2}
            rows={3}
            aria-invalid={error?.field === "description" || undefined}
            aria-describedby={describedBy("description")}
            className={cn(fieldClass, "py-2")}
          />
          {errorFor("description")}
        </div>

        {error ? (
          // Always announced; shown here unless it's already shown inline.
          <p
            role="alert"
            className={
              error.field && INLINE_ERRORS.has(error.field)
                ? "sr-only"
                : "text-danger text-sm"
            }
          >
            {error.message}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={pending || (props.mode === "create" && atCap)}
        >
          {pending
            ? "Saving…"
            : props.mode === "create"
              ? "Add habit"
              : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
