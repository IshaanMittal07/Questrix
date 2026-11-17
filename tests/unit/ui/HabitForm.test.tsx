import { render, screen, within } from "@testing-library/react";
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

describe("HabitForm (create)", () => {
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
    expect(btn).toHaveAttribute("aria-pressed", "true");
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
    await user.click(screen.getByRole("radio", { name: "violet" }));
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
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Specific habits stick/).closest("[aria-live]"),
    ).toHaveAttribute("aria-live", "polite");
    await user.type(screen.getByLabelText("Name"), " 45 min");
    expect(screen.queryByText(/Specific habits stick/)).toBeNull();
  });

  it("suggests stacking when a reminder collides with another habit", async () => {
    const user = userEvent.setup();
    createForm(0, [{ title: "Take supplements", reminder_times: ["09:05"] }]);
    await user.type(screen.getByLabelText("Name"), "Floss every tooth");
    await user.click(
      screen.getByRole("button", { name: "Add a reminder time" }),
    );
    expect(
      screen.getByText("Stack it with Take supplements at 09:05?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("After I take supplements, I will floss every tooth."),
    ).toBeInTheDocument();
  });

  it("warns in the first week and disables Add at the cap", () => {
    const { unmount } = createForm(5);
    expect(screen.getByText(/Starting with 3–5 habits/)).toBeInTheDocument();
    unmount();
    createForm(20);
    expect(screen.getByText(/limit of 20 active habits/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add habit" })).toBeDisabled();
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

describe("HabitForm (edit)", () => {
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
    expect(updateHabit).toHaveBeenCalledWith("h1", {
      ...initial,
      description: null,
    });
    expect(push).toHaveBeenCalledWith("/habits");
  });
});
