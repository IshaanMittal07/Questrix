import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createHabit = vi.fn();
const updateHabit = vi.fn();
vi.mock("@/lib/habits/actions", () => ({
  createHabit: (...a: unknown[]) => createHabit(...a),
  updateHabit: (...a: unknown[]) => updateHabit(...a),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { HabitForm } = await import("@/components/habits/HabitForm");

// Hint text also appears in the sr-only status region; query the visible copy.
const VISIBLE = { ignore: "script, style, [role=status]" };

const NOW = "2026-11-17T12:00:00.000Z";
const coaching = (
  n = 0,
  extra: { title: string; reminder_times: string[] }[] = [],
) => ({
  activeHabits: [
    ...Array.from({ length: n }, (_, i) => ({
      title: `Habit ${i}`,
      reminder_times: [],
    })),
    ...extra,
  ],
  onboardedAt: "2026-11-16T12:00:00.000Z",
  now: NOW,
});

const createForm = (n = 0, extra?: Parameters<typeof coaching>[1]) =>
  render(
    <HabitForm
      mode="create"
      suggestions={[
        { key: "stretch", reasons: ["pair"], pairedWith: "Workout" },
        { key: "meditate", reasons: ["category_gap"] },
      ]}
      coaching={coaching(n, extra)}
    />,
  );

beforeEach(() => {
  createHabit.mockReset();
  updateHabit.mockReset();
  push.mockReset();
  createHabit.mockResolvedValue({ ok: true, data: { id: "x" } });
  updateHabit.mockResolvedValue({ ok: true, data: undefined });
});

// userEvent typing is slow when the whole suite runs in parallel.
describe("HabitForm (create)", { timeout: 20_000 }, () => {
  it("shows suggestions with their reasons", () => {
    createForm();
    const list = screen.getByRole("list", { name: "Suggested for you" });
    expect(
      within(list).getByRole("button", { name: /Stretch 10 min/ }),
    ).toHaveTextContent("Pairs with Workout");
    expect(
      within(list).getByRole("button", { name: /Meditate 10 min/ }),
    ).toHaveTextContent("New area");
  });

  it("fills the form from a suggestion and submits it with its template key", async () => {
    const user = userEvent.setup();
    createForm();
    await user.click(
      within(screen.getByRole("list", { name: "Suggested for you" })).getByRole(
        "button",
        { name: /Stretch 10 min/ },
      ),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Stretch 10 min");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Reminder time 1")).toHaveValue("07:15");
    expect(
      screen.getByText(/Filled in from the Stretch 10 min template/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createHabit).toHaveBeenCalledWith({
      title: "Stretch 10 min",
      description: null,
      icon: expect.any(String),
      category: "fitness",
      difficulty: "easy",
      color: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      target_per_day: 1,
      reminder_times: ["07:15"],
      reminders_enabled: true,
      template_key: "stretch",
    });
    expect(push).toHaveBeenCalledWith("/habits");
  });

  it("lets you pick any template from the full library", async () => {
    const user = userEvent.setup();
    createForm();
    await user.click(screen.getByText("Browse all 30 templates"));
    const btn = screen.getByRole("button", { name: /Take medication/ });
    await user.click(btn);
    expect(btn).toHaveTextContent(/, selected$/);
    expect(screen.getByLabelText("Category")).toHaveValue("health");
    expect(
      screen.getByRole("checkbox", { name: "Remind me" }),
    ).not.toBeChecked();
  });

  it("builds a custom habit from the fields, without a template key", async () => {
    const user = userEvent.setup();
    createForm();
    await user.type(screen.getByLabelText("Name"), "Practise guitar 20 min");
    await user.selectOptions(screen.getByLabelText("Category"), "learning");
    await user.click(screen.getByRole("radio", { name: "Hard" }));
    await user.click(screen.getByRole("button", { name: "Sunday" }));
    await user.click(screen.getByRole("button", { name: "Saturday" }));
    await user.selectOptions(screen.getByLabelText("Times per day"), "2");
    await user.click(
      screen.getByRole("button", { name: "Add a reminder time" }),
    );
    await user.click(screen.getByRole("radio", { name: "Violet" }));
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createHabit).toHaveBeenCalledWith({
      title: "Practise guitar 20 min",
      description: null,
      icon: null,
      category: "learning",
      difficulty: "hard",
      color: "violet",
      days_of_week: [1, 2, 3, 4, 5],
      target_per_day: 2,
      reminder_times: ["09:00"],
      reminders_enabled: true,
    });
  });

  it("announces coaching hints as you type", async () => {
    const user = userEvent.setup();
    createForm();
    await user.type(screen.getByLabelText("Name"), "Study");
    expect(
      screen.getByText(
        /Add an amount or a time, like "Study 45 min for \[exam\]"/,
        VISIBLE,
      ),
    ).toBeInTheDocument();
    // Announced once, through the always-present status region.
    const status = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("Specific habits stick"));
    expect(status).toHaveClass("sr-only");
    // Still vague while typing: the announcement doesn't change.
    const before = status?.textContent;
    await user.type(screen.getByLabelText("Name"), " hard");
    expect(status?.textContent).toBe(before);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Study 45 min");
    expect(screen.queryByText(/Specific habits stick/, VISIBLE)).toBeNull();
    // Nothing left to say: the region is cleared.
    expect(status).toHaveTextContent("");
  });

  it("suggests stacking when a reminder collides with another habit", async () => {
    const user = userEvent.setup();
    createForm(0, [{ title: "Take supplements", reminder_times: ["09:05"] }]);
    await user.type(screen.getByLabelText("Name"), "Floss every tooth");
    await user.click(
      screen.getByRole("button", { name: "Add a reminder time" }),
    );
    expect(
      screen.getByText("Stack it with Take supplements at 09:05?", VISIBLE),
    ).toBeInTheDocument();
    expect(
      screen.getByText("After I take supplements, I will floss every tooth."),
    ).toBeInTheDocument();
  });

  it("warns in the first week and disables Add at the cap", () => {
    const { unmount } = createForm(5);
    expect(
      screen.getByText(/Starting with 3–5 habits/, VISIBLE),
    ).toBeInTheDocument();
    unmount();
    createForm(20);
    const cap = screen.getByText(/limit of 20 active habits/, VISIBLE);
    // aria-disabled keeps it focusable, and it explains why.
    const add = screen.getByRole("button", { name: "Add habit" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAccessibleDescription(cap.textContent!);
  });

  it("doesn't submit at the cap, by click or by Enter", async () => {
    const user = userEvent.setup();
    createForm(20);
    await user.type(screen.getByLabelText("Name"), "Read 20 pages{Enter}");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createHabit).not.toHaveBeenCalled();
  });

  it("shows a server field error next to the field and focuses it", async () => {
    const user = userEvent.setup();
    createHabit.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Give your habit a name",
      field: "title",
    });
    createForm();
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    const name = screen.getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Give your habit a name");
    expect(name).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give your habit a name",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows errors without a field visibly", async () => {
    const user = userEvent.setup();
    createHabit.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      error: "You can create at most 30 habits a day. Try again later.",
    });
    createForm();
    await user.type(screen.getByLabelText("Name"), "Read 20 pages");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("at most 30 habits a day");
    expect(alert).not.toHaveClass("sr-only");
  });

  it("removes a reminder time", async () => {
    const user = userEvent.setup();
    createForm();
    await user.click(
      screen.getByRole("button", { name: "Add a reminder time" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove reminder time 1" }),
    );
    expect(screen.queryByLabelText("Reminder time 1")).toBeNull();
  });
});

// userEvent typing is slow when the whole suite runs in parallel.
describe("HabitForm (edit)", { timeout: 20_000 }, () => {
  const initial = {
    title: "Read 20 pages",
    description: "Before bed",
    icon: "📖",
    category: "learning" as const,
    difficulty: "medium" as const,
    color: "cyan",
    days_of_week: [1, 3, 5],
    target_per_day: 1,
    reminder_times: ["21:00"],
    reminders_enabled: true,
  };

  it("pre-fills, hides templates and saves every field", async () => {
    const user = userEvent.setup();
    render(
      <HabitForm
        mode="edit"
        habitId="h1"
        initial={initial}
        coaching={coaching(20)}
      />,
    );
    expect(screen.queryByText("Start from a template")).toBeNull();
    // Count hints don't apply when editing.
    expect(screen.queryByText(/limit of 20/)).toBeNull();
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.clear(screen.getByLabelText(/Notes/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    // reminders_enabled is unchanged, so it isn't sent (#102).
    const { reminders_enabled: _unchanged, ...rest } = initial;
    void _unchanged;
    expect(updateHabit).toHaveBeenCalledWith("h1", {
      ...rest,
      description: null,
    });
    expect(push).toHaveBeenCalledWith("/habits");
  });

  it("sends reminders_enabled only when it was changed here (#102)", async () => {
    const user = userEvent.setup();
    render(
      <HabitForm
        mode="edit"
        habitId="h1"
        initial={initial}
        coaching={coaching(1)}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Remind me" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateHabit).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({
        reminders_enabled: !initial.reminders_enabled,
      }),
    );
  });
});

// userEvent typing is slow when the whole suite runs in parallel.
describe("HabitForm (field edge cases)", { timeout: 20_000 }, () => {
  const editInitial = {
    title: "Read 20 pages",
    description: "",
    icon: "",
    category: "learning" as const,
    difficulty: "medium" as const,
    color: "cyan",
    days_of_week: [1, 3, 5],
    target_per_day: 1,
    reminder_times: ["21:00"],
    reminders_enabled: true,
  };
  const editForm = (
    over: Partial<typeof editInitial> = {},
    doneHref?: string,
  ) =>
    render(
      <HabitForm
        mode="edit"
        habitId="h1"
        initial={{ ...editInitial, ...over }}
        coaching={coaching()}
        doneHref={doneHref}
      />,
    );
  const lastFields = () =>
    updateHabit.mock.calls.at(-1)![1] as Record<string, unknown>;
  const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  it("toggles days off and back on, and can send no days at all", async () => {
    const user = userEvent.setup();
    editForm();
    const mon = screen.getByRole("button", { name: "Monday" });
    await user.click(mon);
    expect(mon).toHaveAttribute("aria-pressed", "false");
    await user.click(mon);
    expect(mon).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect([...(lastFields().days_of_week as number[])].sort()).toEqual([
      1, 3, 5,
    ]);

    for (const name of ["Monday", "Wednesday", "Friday"]) {
      await user.click(screen.getByRole("button", { name }));
    }
    for (const name of DAYS) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(lastFields().days_of_week).toEqual([]);
  });

  it("lists days Monday first", () => {
    editForm();
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((n): n is string => DAYS.includes(n ?? ""));
    expect(names).toEqual(DAYS);
  });

  it("sends reminders_enabled false but keeps the times when unchecked", async () => {
    const user = userEvent.setup();
    editForm();
    const remind = screen.getByRole("checkbox", { name: "Remind me" });
    expect(remind).toBeChecked();
    await user.click(remind);
    expect(remind).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(lastFields()).toMatchObject({
      reminders_enabled: false,
      reminder_times: ["21:00"],
    });
  });

  it("drops cleared reminder times on submit", async () => {
    const user = userEvent.setup();
    editForm({ reminder_times: ["21:00", "07:00"] });
    fireEvent.change(screen.getByLabelText("Reminder time 1"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(lastFields().reminder_times).toEqual(["07:00"]);
  });

  it("hides Add a reminder time at the limit of 5", async () => {
    const user = userEvent.setup();
    editForm({ reminder_times: ["06:00", "07:00", "08:00", "09:00"] });
    await user.click(
      screen.getByRole("button", { name: "Add a reminder time" }),
    );
    expect(screen.getByLabelText("Reminder time 5")).toHaveValue("09:00");
    expect(
      screen.queryByRole("button", { name: "Add a reminder time" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Remove reminder time 5" }),
    );
    expect(
      screen.getByRole("button", { name: "Add a reminder time" }),
    ).toBeInTheDocument();
  });

  it("sends a typed icon and description", async () => {
    const user = userEvent.setup();
    createForm();
    await user.type(screen.getByLabelText("Name"), "Read 20 pages");
    await user.type(screen.getByLabelText("Icon"), "*");
    await user.type(screen.getByLabelText(/Notes/), "Before bed");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Read 20 pages",
        icon: "*",
        description: "Before bed",
      }),
    );
  });

  it("starts on No colour and can clear a colour back to null", async () => {
    const user = userEvent.setup();
    const { unmount } = createForm();
    expect(screen.getByRole("radio", { name: "No colour" })).toBeChecked();
    unmount();

    editForm();
    expect(screen.getByRole("radio", { name: "Cyan" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "No colour" }));
    expect(screen.getByRole("radio", { name: "No colour" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Cyan" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(lastFields().color).toBeNull();
  });

  it("marks the Days group invalid, describes it and focuses Monday", async () => {
    const user = userEvent.setup();
    updateHabit.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Pick at least one day",
      field: "days_of_week",
    });
    editForm({ days_of_week: [] });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Monday" })).toHaveFocus();
    const days = screen.getByRole("group", { name: "Days" });
    expect(days).toHaveAttribute("aria-invalid", "true");
    expect(days).toHaveAccessibleDescription("Pick at least one day");
    expect(push).not.toHaveBeenCalled();
  });

  it("focuses the first reminder time for a reminder_times error", async () => {
    const user = userEvent.setup();
    updateHabit.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Reminder times must be different",
      field: "reminder_times",
    });
    editForm({ reminder_times: ["09:00", "09:00"] });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByLabelText("Reminder time 1")).toHaveFocus();
    const group = screen.getByRole("group", { name: "Reminders" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription(
      "Reminder times must be different",
    );
  });

  it("focuses Add a reminder time for a reminder_times error with no times", async () => {
    const user = userEvent.setup();
    updateHabit.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Add a reminder time or turn reminders off",
      field: "reminder_times",
    });
    editForm({ reminder_times: [] });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      screen.getByRole("button", { name: "Add a reminder time" }),
    ).toHaveFocus();
  });

  it("describes and focuses the icon and notes fields on their errors", async () => {
    const user = userEvent.setup();
    updateHabit.mockResolvedValueOnce({
      ok: false,
      code: "invalid",
      error: "Use a single emoji",
      field: "icon",
    });
    editForm({ icon: "ab" });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const icon = screen.getByLabelText("Icon");
    expect(icon).toHaveFocus();
    expect(icon).toHaveAttribute("aria-invalid", "true");
    expect(icon).toHaveAccessibleDescription("Use a single emoji");

    updateHabit.mockResolvedValueOnce({
      ok: false,
      code: "invalid",
      error: "Notes are too long",
      field: "description",
    });
    // The first save's transition must finish before Save is back.
    await user.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );
    const notes = screen.getByLabelText(/Notes/);
    expect(notes).toHaveFocus();
    expect(notes).toHaveAccessibleDescription("Notes are too long");
    // The earlier icon error is gone.
    expect(icon).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Use a single emoji")).toBeNull();
  });

  it("shows a field error with no inline slot visibly and focuses the field", async () => {
    const user = userEvent.setup();
    updateHabit.mockResolvedValue({
      ok: false,
      code: "invalid",
      error: "Pick a category",
      field: "category",
    });
    editForm();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Pick a category");
    expect(alert).not.toHaveClass("sr-only");
    expect(screen.getByLabelText("Category")).toHaveFocus();
  });

  it("disables submit while saving, then goes to doneHref", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    updateHabit.mockReturnValue(new Promise((r) => (resolve = r)));
    editForm({}, "/today");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: /^Saving/ })).toBeDisabled();
    await act(async () => resolve({ ok: true, data: undefined }));
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("does not disable Save at the habit cap when editing", () => {
    render(
      <HabitForm
        mode="edit"
        habitId="h1"
        initial={editInitial}
        coaching={coaching(20)}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).not.toBeDisabled();
  });

  it("goes to doneHref after creating, with no suggestions list when empty", async () => {
    const user = userEvent.setup();
    render(
      <HabitForm
        mode="create"
        suggestions={[]}
        coaching={coaching()}
        doneHref="/onboarding/next"
      />,
    );
    expect(
      screen.queryByRole("list", { name: "Suggested for you" }),
    ).toBeNull();
    await user.type(screen.getByLabelText("Name"), "Read 20 pages");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(push).toHaveBeenCalledWith("/onboarding/next");
  });

  it("skips suggestions whose template no longer exists", () => {
    render(
      <HabitForm
        mode="create"
        suggestions={[
          { key: "no-such-template", reasons: ["popular"] },
          { key: "meditate", reasons: ["popular"] },
        ]}
        coaching={coaching()}
      />,
    );
    const list = screen.getByRole("list", { name: "Suggested for you" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByRole("button")).toHaveTextContent(
      "Popular with friends",
    );
  });
});
