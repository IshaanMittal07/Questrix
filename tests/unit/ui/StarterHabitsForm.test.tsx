import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addStarterHabits = vi.fn();
vi.mock("@/lib/habits/actions", () => ({
  addStarterHabits: (...a: unknown[]) => addStarterHabits(...a),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { HABIT_TEMPLATES } = await import("@/lib/habits/templates");
const { StarterHabitsForm } =
  await import("@/app/onboarding/habits/StarterHabitsForm");

const suggestions = [
  { key: "sleep_by_23", reasons: ["category_gap" as const] },
  { key: "meditate", reasons: ["category_gap" as const] },
  { key: "workout", reasons: ["category_gap" as const] },
  { key: "drink_water", reasons: ["slot_gap" as const] },
];

const suggested = () =>
  within(screen.getByRole("group", { name: "Suggested for you" }));

beforeEach(() => {
  addStarterHabits.mockReset();
  push.mockReset();
  addStarterHabits.mockResolvedValue({ ok: true, data: { count: 1 } });
});

describe("StarterHabitsForm", { timeout: 20_000 }, () => {
  it("lists suggestions first, with every other template under More", () => {
    render(<StarterHabitsForm suggestions={suggestions} />);
    expect(suggested().getAllByRole("checkbox")).toHaveLength(4);
    expect(
      suggested().getByRole("checkbox", { name: /Sleep by 23:00/ }),
    ).toBeInTheDocument();
    // 30 templates in all, each listed once.
    expect(screen.getAllByRole("checkbox", { hidden: true })).toHaveLength(30);
  });

  it("starts with nothing picked, and Add unavailable", () => {
    render(<StarterHabitsForm suggestions={suggestions} />);
    expect(
      screen.getByRole("button", { name: "Pick a habit to add" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute(
      "href",
      "/onboarding/notifications",
    );
  });

  it("caps picks at 3, explains why, and allows swapping", async () => {
    const user = userEvent.setup();
    render(<StarterHabitsForm suggestions={suggestions} />);
    const boxes = suggested().getAllByRole("checkbox");
    for (const b of boxes.slice(0, 3)) await user.click(b);
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 of 3 picked. Unpick one to choose another.",
    );

    await user.click(boxes[3]);
    expect(boxes[3]).not.toBeChecked();
    expect(boxes[3]).toHaveAttribute("aria-disabled", "true");
    expect(boxes[3]).toHaveAccessibleDescription(/3 of 3 picked/);

    await user.click(boxes[0]);
    await user.click(boxes[3]);
    expect(boxes[3]).toBeChecked();
    expect(screen.getByRole("button", { name: "Add 3 habits" })).toBeEnabled();
  });

  it("sends only template keys, then goes to Today", async () => {
    const user = userEvent.setup();
    render(<StarterHabitsForm suggestions={suggestions} />);
    await user.click(
      suggested().getByRole("checkbox", { name: /Meditate 10 min/ }),
    );
    await user.click(screen.getByText("More habits"));
    await user.click(screen.getByRole("checkbox", { name: /Floss/ }));
    await user.click(screen.getByRole("button", { name: "Add 2 habits" }));
    expect(addStarterHabits).toHaveBeenCalledWith(["meditate", "floss"]);
    expect(push).toHaveBeenCalledWith("/onboarding/notifications");
  });

  it("shows a server error and stays", async () => {
    const user = userEvent.setup();
    addStarterHabits.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      error: "You can create at most 30 habits a day. Try again later.",
    });
    render(<StarterHabitsForm suggestions={suggestions} />);
    await user.click(suggested().getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Add 1 habit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at most 30 habits a day",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("counts picks in the status and Add label as you go", async () => {
    const user = userEvent.setup();
    render(<StarterHabitsForm suggestions={suggestions} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Pick up to 3.");
    const boxes = suggested().getAllByRole("checkbox");

    await user.click(boxes[0]);
    expect(status).toHaveTextContent(/^1 of 3 picked\.$/);
    expect(screen.getByRole("button", { name: "Add 1 habit" })).toBeEnabled();

    await user.click(boxes[1]);
    expect(status).toHaveTextContent(/^2 of 3 picked\.$/);
    expect(screen.getByRole("button", { name: "Add 2 habits" })).toBeEnabled();

    await user.click(boxes[0]);
    await user.click(boxes[1]);
    expect(status).toHaveTextContent("Pick up to 3.");
    expect(
      screen.getByRole("button", { name: "Pick a habit to add" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("toggles with Space from the keyboard, and respects the cap", async () => {
    const user = userEvent.setup();
    render(<StarterHabitsForm suggestions={suggestions} />);
    const boxes = suggested().getAllByRole("checkbox");

    await user.tab();
    expect(boxes[0]).toHaveFocus();
    await user.keyboard(" ");
    expect(boxes[0]).toBeChecked();
    await user.keyboard(" ");
    expect(boxes[0]).not.toBeChecked();

    for (const b of boxes.slice(0, 3)) {
      b.focus();
      await user.keyboard(" ");
    }
    boxes[3].focus();
    await user.keyboard(" ");
    expect(boxes[3]).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3 picked.");
  });

  it("shows Adding… and blocks resubmits while the server works", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    addStarterHabits.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<StarterHabitsForm suggestions={suggestions} />);
    await user.click(suggested().getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Add 1 habit" }));

    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(addStarterHabits).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    resolve({ ok: true, data: { count: 1 } });
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/onboarding/notifications"),
    );
  });

  it("clears a server error when the picks change", async () => {
    const user = userEvent.setup();
    addStarterHabits.mockResolvedValue({
      ok: false,
      code: "unknown",
      error: "Something went wrong.",
    });
    render(<StarterHabitsForm suggestions={suggestions} />);
    const boxes = suggested().getAllByRole("checkbox");
    await user.click(boxes[0]);
    await user.click(screen.getByRole("button", { name: "Add 1 habit" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The alert can land before the transition ends; picks are locked till then.
    await waitFor(() => expect(boxes[1]).not.toHaveAttribute("aria-disabled"));
    await user.click(boxes[1]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains why Add is unavailable and ignores it when nothing is picked", async () => {
    const user = userEvent.setup();
    render(<StarterHabitsForm suggestions={suggestions} />);
    const add = screen.getByRole("button", { name: "Pick a habit to add" });
    expect(add).toHaveAccessibleDescription(/Pick up to 3/);
    await user.click(add);
    expect(addStarterHabits).not.toHaveBeenCalled();
  });

  it("names each checkbox by its title, with the category as description", () => {
    render(<StarterHabitsForm suggestions={suggestions} />);
    const box = suggested().getByRole("checkbox", { name: "Sleep by 23:00" });
    expect(box).toHaveAccessibleDescription("Health");
  });

  it("stays on the page with a message when the action throws", async () => {
    const user = userEvent.setup();
    addStarterHabits.mockRejectedValue(new Error("network"));
    render(<StarterHabitsForm suggestions={suggestions} />);
    await user.click(suggested().getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Add 1 habit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't add your habits. Try again, or skip for now.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Skip for now" })).toBeVisible();
  });

  it("doesn't offer templates the user already has", () => {
    render(
      <StarterHabitsForm
        suggestions={suggestions}
        ownedKeys={["meditate", "floss"]}
      />,
    );
    expect(suggested().getAllByRole("checkbox")).toHaveLength(3);
    expect(
      screen.queryByRole("checkbox", { name: "Floss", hidden: true }),
    ).toBeNull();
    expect(screen.getAllByRole("checkbox", { hidden: true })).toHaveLength(
      HABIT_TEMPLATES.length - 2,
    );
  });

  it("hides an empty suggestions group", () => {
    render(<StarterHabitsForm suggestions={[]} />);
    expect(
      screen.queryByRole("group", { name: "Suggested for you" }),
    ).toBeNull();
  });

  it("is inert while adding: no toggles, no Skip", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    addStarterHabits.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<StarterHabitsForm suggestions={suggestions} />);
    const boxes = suggested().getAllByRole("checkbox");
    await user.click(boxes[0]);
    await user.click(screen.getByRole("button", { name: "Add 1 habit" }));
    await screen.findByRole("button", { name: "Adding…" });

    await user.click(boxes[1]);
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[1]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 picked.");

    const skip = screen.getByRole("link", { name: "Skip for now" });
    expect(skip).toHaveAttribute("aria-disabled", "true");
    // fireEvent returns false when the click's default (navigation) was
    // prevented.
    expect(fireEvent.click(skip)).toBe(false);

    resolve({ ok: true, data: { count: 1 } });
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/onboarding/notifications"),
    );
  });

  it("skips unknown suggestion keys", () => {
    render(
      <StarterHabitsForm
        suggestions={[{ key: "nope", reasons: ["pair"] }, ...suggestions]}
      />,
    );
    expect(suggested().getAllByRole("checkbox")).toHaveLength(4);
  });
});
