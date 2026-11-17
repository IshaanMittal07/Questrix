import { act, render, screen, within } from "@testing-library/react";
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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

  it("moves focus to a neighbour after archiving, or to Add when empty", async () => {
    const user = userEvent.setup();
    archiveHabit.mockReturnValue(hang());
    const { unmount } = render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Archive Bravo" }));
    expect(screen.getByRole("link", { name: "Charlie, edit" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Archive Charlie" }));
    expect(screen.getByRole("link", { name: "Alpha, edit" })).toHaveFocus();
    unmount();
    render(<HabitList active={[habit("a", "Alpha")]} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Archive Alpha" }));
    expect(screen.getByRole("link", { name: "Add habit" })).toHaveFocus();
  });

  it("blocks a second restore while one is pending", async () => {
    const user = userEvent.setup();
    unarchiveHabit.mockReturnValue(hang());
    render(
      <HabitList
        active={three}
        archived={[habit("y", "Yankee"), habit("z", "Zulu")]}
      />,
    );
    await user.click(screen.getByText("Archived (2)"));
    await user.click(screen.getByRole("button", { name: "Restore Zulu" }));
    expect(
      screen.getByRole("button", { name: "Restore Zulu" }),
    ).toHaveTextContent("Restoring…");
    await user.click(screen.getByRole("button", { name: "Restore Zulu" }));
    await user.click(screen.getByRole("button", { name: "Restore Yankee" }));
    expect(unarchiveHabit).toHaveBeenCalledTimes(1);
  });

  it("focuses the restored habit once the server list includes it", async () => {
    const user = userEvent.setup();
    const zulu = habit("z", "Zulu");
    const { rerender } = render(<HabitList active={three} archived={[zulu]} />);
    await user.click(screen.getByText("Archived (1)"));
    await user.click(screen.getByRole("button", { name: "Restore Zulu" }));
    // Not there yet: focus waits for the refreshed list.
    rerender(<HabitList active={[...three, zulu]} archived={[]} />);
    expect(screen.getByRole("link", { name: "Zulu, edit" })).toHaveFocus();
    // A later, unrelated update doesn't move focus again.
    screen.getByRole("link", { name: "Alpha, edit" }).focus();
    rerender(<HabitList active={[zulu, ...three]} archived={[]} />);
    expect(screen.getByRole("link", { name: "Alpha, edit" })).toHaveFocus();
  });

  it("does nothing when Add is clicked at the cap", async () => {
    const user = userEvent.setup();
    const full = Array.from({ length: 20 }, (_, i) => habit(`h${i}`, `H${i}`));
    render(<HabitList active={full} archived={[]} />);
    const add = screen.getByRole("button", { name: "Add habit" });
    await user.click(add);
    expect(add.closest("a")).toBeNull();
    expect(add).toHaveAttribute("aria-disabled", "true");
  });

  it("refreshes the list when the server says the order is stale", async () => {
    const user = userEvent.setup();
    reorderHabits.mockResolvedValue({
      ok: false,
      code: "stale",
      error: "Your list changed. Refresh and try again.",
    });
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Move Alpha down" }));
    await screen.findByRole("alert");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't move Alpha. The order was restored.",
    );
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
    // aria-disabled, not disabled: still focusable, so the reason is heard.
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAccessibleDescription(/20 active habits/);
    expect(screen.queryByRole("link", { name: "Add habit" })).toBeNull();
    const restore = screen.getByRole("button", {
      name: "Restore Zulu",
      hidden: true,
    });
    expect(restore).toHaveAttribute("aria-disabled", "true");
    expect(restore).toHaveAccessibleDescription(/20 active habits/);
    restore.click();
    expect(unarchiveHabit).not.toHaveBeenCalled();
  });
});

describe("HabitList summaries and accents", () => {
  const cardOf = (title: string) =>
    screen.getByRole("link", { name: `${title}, edit` }).closest("li")!
      .firstElementChild as HTMLElement;

  it.each([
    [{ days_of_week: [1, 2, 3, 4, 5] }, "Weekdays"],
    [{ days_of_week: [0, 6] }, "Weekends"],
    [{ days_of_week: [3, 1, 0] }, "Mon, Wed, Sun"],
    [{ days_of_week: [] }, "No days"],
    [{ target_per_day: 2 }, "Every day · 2× a day"],
    [{ reminder_times: ["07:15:00"] }, "Every day · 07:15"],
    // Times are hidden while reminders are off, and 1× a day is implied.
    [{ reminder_times: ["07:15:00"], reminders_enabled: false }, "Every day"],
    [
      {
        days_of_week: [1, 2, 3, 4, 5],
        target_per_day: 3,
        reminder_times: ["08:00:00", "18:30:00"],
      },
      "Weekdays · 3× a day · 08:00, 18:30",
    ],
  ] satisfies Array<[Partial<Item>, string]>)(
    "summarises %j as %s",
    (over, text) => {
      render(<HabitList active={[habit("a", "Alpha", over)]} archived={[]} />);
      const card = cardOf("Alpha");
      expect(within(card).getByText(text, { exact: true })).toHaveClass(
        "text-muted",
      );
    },
  );

  it("gives each card its colour accent, or a neutral one", () => {
    render(
      <HabitList
        active={[
          habit("a", "Alpha", { color: "violet" }),
          habit("b", "Bravo", { color: "warning" }),
          habit("c", "Charlie"),
          habit("d", "Delta", { color: "not-a-colour" }),
        ]}
        archived={[]}
      />,
    );
    expect(cardOf("Alpha")).toHaveClass("border-l-violet");
    expect(cardOf("Bravo")).toHaveClass("border-l-warning");
    expect(cardOf("Charlie")).toHaveClass("border-l-white/10");
    expect(cardOf("Delta")).toHaveClass("border-l-white/10");
    expect(cardOf("Delta").className).not.toMatch(/not-a-colour/);
  });

  it("shows the icon, or a bullet, hidden from screen readers", () => {
    render(
      <HabitList
        active={[habit("a", "Alpha", { icon: "📖" }), habit("b", "Bravo")]}
        archived={[]}
      />,
    );
    const icon = within(cardOf("Alpha")).getByText("📖");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(within(cardOf("Bravo")).getByText("•")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("has no archived section when nothing is archived", () => {
    render(<HabitList active={three} archived={[]} />);
    expect(screen.queryByText(/Archived \(/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Archived habits" })).toBeNull();
  });
});

describe("HabitList failures", () => {
  it("puts the habit back and shows the error when archiving fails", async () => {
    const user = userEvent.setup();
    archiveHabit.mockResolvedValue({
      ok: false,
      code: "not_found",
      error: "That habit no longer exists.",
    });
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Archive Bravo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That habit no longer exists.",
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("shows the error and announces nothing when a restore fails", async () => {
    const user = userEvent.setup();
    unarchiveHabit.mockResolvedValue({
      ok: false,
      code: "limit",
      error: "You already have 20 active habits.",
    });
    render(<HabitList active={three} archived={[habit("z", "Zulu")]} />);
    await user.click(screen.getByText("Archived (1)"));
    await user.click(screen.getByRole("button", { name: "Restore Zulu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have 20 active habits.",
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("clears an earlier error on the next action", async () => {
    const user = userEvent.setup();
    reorderHabits.mockResolvedValueOnce({
      ok: false,
      code: "stale",
      error: "Your list changed. Refresh and try again.",
    });
    render(<HabitList active={three} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Move Alpha down" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    archiveHabit.mockReturnValue(hang());
    await user.click(screen.getByRole("button", { name: "Archive Charlie" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
