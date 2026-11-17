import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reorderHabits = vi.fn();
const archiveHabit = vi.fn();
const unarchiveHabit = vi.fn();
vi.mock("@/lib/habits/actions", () => ({
  reorderHabits: (...a: unknown[]) => reorderHabits(...a),
  archiveHabit: (...a: unknown[]) => archiveHabit(...a),
  unarchiveHabit: (...a: unknown[]) => unarchiveHabit(...a),
}));

const { HabitList } = await import("@/components/habits/HabitList");
type Item = Parameters<typeof HabitList>[0]["active"][number];

const habit = (id: string, title: string, over: Partial<Item> = {}): Item => ({
  id,
  title,
  icon: null,
  color: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  target_per_day: 1,
  reminder_times: [],
  reminders_enabled: true,
  ...over,
});

const three = [habit("a", "Alpha"), habit("b", "Bravo"), habit("c", "Charlie")];
const titles = () =>
  within(screen.getByRole("list", { name: "Your habits" }))
    .getAllByRole("link")
    .map((l) => l.textContent?.replace(", edit", ""));

// React keeps all pending async transitions in one scope, and optimistic
// state only reverts once every one settles. Settle the ones a test leaves
// pending, or they leak into the next test.
const pending: Array<(v: unknown) => void> = [];
const hang = () =>
  new Promise((resolve) => {
    pending.push(resolve);
  });
afterEach(async () => {
  await act(async () => {
    for (const resolve of pending.splice(0)) {
      resolve({ ok: true, data: undefined });
    }
  });
});

beforeEach(() => {
  for (const fn of [reorderHabits, archiveHabit, unarchiveHabit]) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: true, data: undefined });
  }
});

describe("HabitList", () => {
  it("lists habits in order with an edit link and a schedule summary", () => {
    render(
      <HabitList
        active={[
          habit("a", "Drink water", {
            target_per_day: 4,
            reminder_times: ["09:00:00", "12:00:00"],
          }),
        ]}
        archived={[]}
      />,
    );
    const link = screen.getByRole("link", { name: "Drink water, edit" });
    expect(link).toHaveAttribute("href", "/habits/a/edit");
    expect(
      screen.getByText("Every day · 4× a day · 09:00, 12:00"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add habit" })).toHaveAttribute(
      "href",
      "/habits/new",
    );
  });

  it("shows an empty state", () => {
    render(<HabitList active={[]} archived={[]} />);
    expect(screen.getByText(/No habits yet/)).toBeInTheDocument();
  });

  it("disables move up on the first habit and move down on the last", () => {
    render(<HabitList active={three} archived={[]} />);
    expect(
      screen.getByRole("button", { name: "Move Alpha up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Charlie down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Bravo up" }),
    ).not.toBeDisabled();
  });

  it("reorders with the keyboard, sends the full order and announces it", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    reorderHabits.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<HabitList active={three} archived={[]} />);

    screen.getByRole("button", { name: "Move Alpha down" }).focus();
    await user.keyboard("{Enter}");

    // Optimistic: reordered before the server answers.
    expect(titles()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(reorderHabits).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Alpha moved to position 2 of 3.",
    );
    // Focus follows the moved habit.
    expect(
      screen.getByRole("button", { name: "Move Alpha down" }),
    ).toHaveFocus();
    await act(async () => resolve({ ok: true, data: undefined }));
  });

  it("moves focus to the other button when a move disables it", async () => {
    const user = userEvent.setup();
    reorderHabits.mockReturnValue(hang());
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Move Bravo up" }));
    expect(titles()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(
      screen.getByRole("button", { name: "Move Bravo down" }),
    ).toHaveFocus();
  });

  it("rolls back and shows the error when the server refuses", async () => {
    const user = userEvent.setup();
    reorderHabits.mockResolvedValue({
      ok: false,
      code: "stale",
      error: "Your list changed. Refresh and try again.",
    });
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Move Alpha down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your list changed",
    );
    // The optimistic order reverts when the transition ends.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("archives a habit optimistically", async () => {
    const user = userEvent.setup();
    archiveHabit.mockReturnValue(hang());
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Archive Bravo" }));
    expect(archiveHabit).toHaveBeenCalledWith("b");
    expect(titles()).toEqual(["Alpha", "Charlie"]);
    expect(screen.getByRole("status")).toHaveTextContent("Bravo archived.");
  });

  it("restores an archived habit", async () => {
    const user = userEvent.setup();
    render(<HabitList active={three} archived={[habit("z", "Zulu")]} />);
    await user.click(screen.getByText("Archived (1)"));
    await user.click(screen.getByRole("button", { name: "Restore Zulu" }));
    expect(unarchiveHabit).toHaveBeenCalledWith("z");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Zulu restored.",
    );
  });

  it("disables Add and Restore at the 20-habit cap, with a reason", () => {
    const full = Array.from({ length: 20 }, (_, i) => habit(`h${i}`, `H${i}`));
    render(<HabitList active={full} archived={[habit("z", "Zulu")]} />);
    const add = screen.getByRole("button", { name: "Add habit" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(/20 active habits/);
    expect(screen.queryByRole("link", { name: "Add habit" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Zulu", hidden: true }),
    ).toBeDisabled();
  });
});
