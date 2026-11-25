import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReminderHabit } from "@/app/(app)/settings/NotificationsCard";

const setNotificationPrefs = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  setNotificationPrefs: (...a: unknown[]) => setNotificationPrefs(...a),
}));
const setHabitReminders = vi.fn();
vi.mock("@/lib/habits/actions", () => ({
  setHabitReminders: (...a: unknown[]) => setHabitReminders(...a),
}));
vi.mock("@/components/push/EnableNotifications", () => ({
  EnableNotifications: () => <p>device-toggle</p>,
}));

const { NotificationsCard } =
  await import("@/app/(app)/settings/NotificationsCard");

const habits: ReminderHabit[] = [
  {
    id: "h1",
    title: "Read",
    icon: null,
    reminderTimes: ["08:00:00", "21:30:00"],
    remindersEnabled: true,
  },
  {
    id: "h2",
    title: "Stretch",
    icon: null,
    reminderTimes: [],
    remindersEnabled: true,
  },
  {
    id: "h3",
    title: "Water",
    icon: "W",
    reminderTimes: ["12:15"],
    remindersEnabled: false,
  },
];
const on = { push_enabled: true, streak_saver_enabled: true };

// Each Switch's name is its label plus its description (both in the button).
const sw = (label: string) =>
  screen.getByRole("switch", { name: new RegExp(`^${label}`) });
const alert = () => screen.getByRole("alert");

// Optimistic state only reverts once every pending transition settles, so
// settle whatever a test leaves hanging.
const pending: Array<(v: unknown) => void> = [];
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pending.push(resolve);
  return { promise, resolve, reject };
}

beforeEach(() => {
  setNotificationPrefs.mockReset();
  setNotificationPrefs.mockResolvedValue({ ok: true });
  setHabitReminders.mockReset();
  setHabitReminders.mockResolvedValue({ ok: true, data: undefined });
});

afterEach(async () => {
  await act(async () => {
    for (const r of pending.splice(0)) r({ ok: true });
  });
});

describe("NotificationsCard", () => {
  it("renders this device's control and the saved prefs", () => {
    render(
      <NotificationsCard
        prefs={{ push_enabled: true, streak_saver_enabled: false }}
        habits={habits}
      />,
    );
    expect(screen.getByText("device-toggle")).toBeInTheDocument();
    expect(sw("Habit reminders")).toHaveAttribute("aria-checked", "true");
    expect(sw("Streak saver")).toHaveAttribute("aria-checked", "false");
    expect(sw("Streak saver")).not.toHaveAttribute("aria-disabled");
    expect(alert()).toBeEmptyDOMElement();
  });

  it("lists only habits with reminder times, with their times as HH:MM", () => {
    render(<NotificationsCard prefs={on} habits={habits} />);
    const list = within(screen.getByRole("list"));
    const items = list.getAllByRole("switch");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName(/^Read/);
    expect(items[0]).toHaveAccessibleDescription("08:00, 21:30");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveAccessibleName(/^W Water/);
    expect(items[1]).toHaveAccessibleDescription("12:15");
    expect(items[1]).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/Stretch/)).toBeNull();
    expect(screen.queryByRole("link", { name: "edit a habit" })).toBeNull();
  });

  it("shows the empty state with a link to /habits when no habit has times", () => {
    render(<NotificationsCard prefs={on} habits={[habits[1]!]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(
      screen.getByText(/None of your habits has a reminder time yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "edit a habit" })).toHaveAttribute(
      "href",
      "/habits",
    );
  });

  it("also shows the empty state with no habits at all", () => {
    render(<NotificationsCard prefs={on} habits={[]} />);
    expect(screen.getByRole("link", { name: "edit a habit" })).toBeVisible();
  });

  it("disables the streak saver and habit switches while Habit reminders is off", async () => {
    render(
      <NotificationsCard
        prefs={{ push_enabled: false, streak_saver_enabled: true }}
        habits={habits}
      />,
    );
    const saver = sw("Streak saver");
    const habitSwitches = within(screen.getByRole("list")).getAllByRole(
      "switch",
    );
    for (const s of [saver, ...habitSwitches]) {
      expect(s).toHaveAttribute("aria-disabled", "true");
    }
    expect(sw("Habit reminders")).not.toHaveAttribute("aria-disabled");
    await userEvent.click(saver);
    await userEvent.click(habitSwitches[0]!);
    expect(setNotificationPrefs).not.toHaveBeenCalled();
    expect(setHabitReminders).not.toHaveBeenCalled();
  });

  it("saves Habit reminders optimistically and keeps it on success", async () => {
    const d = deferred();
    setNotificationPrefs.mockReturnValue(d.promise);
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Habit reminders"));
    expect(setNotificationPrefs).toHaveBeenCalledExactlyOnceWith({
      push_enabled: false,
    });
    // Before the server answers: off, and its dependants disabled.
    expect(sw("Habit reminders")).toHaveAttribute("aria-checked", "false");
    expect(sw("Streak saver")).toHaveAttribute("aria-disabled", "true");
    await act(async () => d.resolve({ ok: true }));
    expect(sw("Habit reminders")).toHaveAttribute("aria-checked", "false");
    expect(sw("Streak saver")).toHaveAttribute("aria-disabled", "true");
    expect(alert()).toBeEmptyDOMElement();
  });

  it("rolls back and alerts when the save fails", async () => {
    const d = deferred();
    setNotificationPrefs.mockReturnValue(d.promise);
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Streak saver"));
    expect(setNotificationPrefs).toHaveBeenCalledExactlyOnceWith({
      streak_saver_enabled: false,
    });
    expect(sw("Streak saver")).toHaveAttribute("aria-checked", "false");
    await act(async () =>
      d.resolve({ ok: false, error: "Something else was saving." }),
    );
    expect(sw("Streak saver")).toHaveAttribute("aria-checked", "true");
    expect(alert()).toHaveTextContent("Something else was saving.");
  });

  it("rolls back with a generic alert when the action throws", async () => {
    const d = deferred();
    setNotificationPrefs.mockReturnValue(d.promise);
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Habit reminders"));
    expect(sw("Habit reminders")).toHaveAttribute("aria-checked", "false");
    await act(async () => d.reject(new Error("network down")));
    expect(sw("Habit reminders")).toHaveAttribute("aria-checked", "true");
    expect(sw("Streak saver")).not.toHaveAttribute("aria-disabled");
    expect(alert()).toHaveTextContent("Couldn't save. Try again.");
  });

  it("clears the alert on the next change", async () => {
    setNotificationPrefs.mockResolvedValueOnce({ ok: false, error: "Nope." });
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Streak saver"));
    await waitFor(() => expect(alert()).toHaveTextContent("Nope."));
    await waitFor(() =>
      expect(sw("Streak saver")).toHaveAttribute("aria-checked", "true"),
    );
    await userEvent.click(sw("Streak saver"));
    expect(alert()).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(sw("Streak saver")).toHaveAttribute("aria-checked", "false"),
    );
    expect(setNotificationPrefs).toHaveBeenCalledTimes(2);
  });

  it("toggles a habit optimistically and keeps it on success", async () => {
    const d = deferred();
    setHabitReminders.mockReturnValue(d.promise);
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("W Water"));
    expect(setHabitReminders).toHaveBeenCalledExactlyOnceWith("h3", true);
    expect(sw("W Water")).toHaveAttribute("aria-checked", "true");
    // Only that habit changes.
    expect(sw("Read")).toHaveAttribute("aria-checked", "true");
    await act(async () => d.resolve({ ok: true, data: undefined }));
    expect(sw("W Water")).toHaveAttribute("aria-checked", "true");
    expect(alert()).toBeEmptyDOMElement();
  });

  it("rolls a habit back and alerts when its save fails", async () => {
    const d = deferred();
    setHabitReminders.mockReturnValue(d.promise);
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Read"));
    expect(setHabitReminders).toHaveBeenCalledExactlyOnceWith("h1", false);
    expect(sw("Read")).toHaveAttribute("aria-checked", "false");
    await act(async () =>
      d.resolve({
        ok: false,
        code: "not_found",
        error: "That habit doesn't exist.",
      }),
    );
    expect(sw("Read")).toHaveAttribute("aria-checked", "true");
    expect(alert()).toHaveTextContent("That habit doesn't exist.");
  });

  it("rolls a habit back with a generic alert when its action throws", async () => {
    setHabitReminders.mockRejectedValue(new Error("offline"));
    render(<NotificationsCard prefs={on} habits={habits} />);
    await userEvent.click(sw("Read"));
    await waitFor(() =>
      expect(alert()).toHaveTextContent("Couldn't save. Try again."),
    );
    await waitFor(() =>
      expect(sw("Read")).toHaveAttribute("aria-checked", "true"),
    );
  });
});
