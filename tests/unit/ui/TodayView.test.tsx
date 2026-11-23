import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import type {
  CompleteEvent,
  Today,
  TodayCompletion,
  TodayHabit,
  UndoEvent,
} from "@/lib/today/types";

const completeHabit = vi.fn();
const undoCompletion = vi.fn();
vi.mock("@/lib/today/actions", () => ({
  completeHabit: (...a: unknown[]) => completeHabit(...a),
  undoCompletion: (...a: unknown[]) => undoCompletion(...a),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { TodayView, applyPending, undoable } =
  await import("@/components/today/TodayView");

// Typed by code point so no invisible look-alikes end up in the source.
const MINUS = String.fromCharCode(0x2212);
const TIMES = String.fromCharCode(0xd7);

const MIN = 60_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const completion = (
  id: string,
  occurrence: number,
  over: Partial<TodayCompletion> = {},
): TodayCompletion => ({
  id,
  occurrence,
  points_awarded: 10,
  completed_at: at(-MIN),
  undoable_until: at(4 * MIN),
  ...over,
});

const habit = (
  id: string,
  title: string,
  over: Partial<TodayHabit> = {},
): TodayHabit => ({
  id,
  title,
  category: "health",
  icon: null,
  color: null,
  difficulty: "medium",
  target: 1,
  done: 0,
  joined_late: false,
  habit_streak: 0,
  completions: [],
  ...over,
});

const day = (over: Partial<Today> = {}): Today => ({
  local_date: "2026-11-18",
  local_hour: 9,
  timezone: "UTC",
  username: "ada",
  display_name: "Ada",
  points_balance: 1234,
  lifetime_points: 120,
  level: 2,
  current_streak: 3,
  longest_streak: 5,
  streak_freezes: 0,
  freezes_needed: 0,
  counted_today: false,
  relived: false,
  scheduled_count: 2,
  completed_count: 0,
  at_risk: false,
  undo_window_minutes: 5,
  habits: [
    habit("h1", "Read"),
    habit("h2", "Drink water", { target: 3, habit_streak: 2 }),
  ],
  ...over,
});

const event = (over: Partial<CompleteEvent> = {}): CompleteEvent => ({
  completion_id: "c-new",
  occurrence: 1,
  target: 1,
  points_awarded: 12,
  multiplier: 1.2,
  current_streak: 4,
  habit_streak: 1,
  milestone: null,
  milestone_points: null,
  ...over,
});

const undoEvent = (over: Partial<UndoEvent> = {}): UndoEvent => ({
  undone_id: "c1",
  habit_id: "h1",
  points_removed: 10,
  milestones_revoked: null,
  milestone_points_removed: 0,
  ...over,
});

function renderView(today: Today) {
  const ui = (t: Today) => (
    <ToastProvider>
      <TodayView today={t} />
    </ToastProvider>
  );
  const r = render(ui(today));
  return { ...r, rerender: (t: Today) => r.rerender(ui(t)) };
}

// The screen's own live region (Radix Toast adds its own status regions).
const live = () =>
  document.querySelector<HTMLElement>('p[role="status"][aria-live="polite"]')!;
const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-habit="${id}"]`)!;

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
      resolve({ ok: false, code: "failed", error: "settled" });
    }
  });
  vi.useRealTimers();
});

beforeEach(() => {
  completeHabit.mockReset();
  undoCompletion.mockReset();
  refresh.mockReset();
});

describe("applyPending", () => {
  const t = day({
    habits: [
      habit("h1", "Read", { done: 1, completions: [completion("c1", 1)] }),
      habit("h2", "Water", { target: 3, done: 1 }),
    ],
  });

  it("adds a pending completion to the habit being completed only", () => {
    const next = applyPending(t, { type: "complete", habitId: "h2" });
    expect(next.habits[1].done).toBe(2);
    expect(next.habits[1].completions.at(-1)).toMatchObject({
      occurrence: 2,
      points_awarded: 0,
    });
    expect(next.habits[0]).toBe(t.habits[0]);
    // Nothing else changes: points are the server's to award.
    expect(next.points_balance).toBe(t.points_balance);
    expect(next.current_streak).toBe(t.current_streak);
  });

  it("never completes past the target", () => {
    const next = applyPending(t, { type: "complete", habitId: "h1" });
    expect(next.habits[0]).toBe(t.habits[0]);
  });

  it("removes the undone completion", () => {
    const next = applyPending(t, { type: "undo", completionId: "c1" });
    expect(next.habits[0]).toMatchObject({ done: 0, completions: [] });
    expect(next.habits[1]).toBe(t.habits[1]);
  });

  it("ignores an unknown completion and never goes below zero", () => {
    expect(
      applyPending(t, { type: "undo", completionId: "nope" }).habits,
    ).toEqual(t.habits);
    const odd = day({
      habits: [habit("h", "X", { done: 0, completions: [completion("c", 1)] })],
    });
    expect(
      applyPending(odd, { type: "undo", completionId: "c" }).habits[0].done,
    ).toBe(0);
  });
});

describe("undoable", () => {
  const now = Date.parse("2026-11-18T09:00:00Z");
  const h = (completions: TodayCompletion[]) =>
    habit("h", "X", { done: completions.length, completions });
  const c = (id: string, until: string) =>
    completion(id, 1, { undoable_until: until });

  it("offers the latest completion while its window is open", () => {
    const last = c("c2", "2026-11-18T09:00:01Z");
    expect(undoable(h([c("c1", "2026-11-18T09:05:00Z"), last]), now)).toBe(
      last,
    );
  });

  it("offers nothing once the window has closed, including at the deadline", () => {
    expect(undoable(h([c("c1", "2026-11-18T09:00:00Z")]), now)).toBeUndefined();
    expect(undoable(h([c("c1", "2026-11-18T08:59:59Z")]), now)).toBeUndefined();
  });

  it("only ever offers the latest completion", () => {
    // An earlier one with an open window is not undoable out of order.
    expect(
      undoable(
        h([c("c1", "2026-11-18T09:05:00Z"), c("c2", "2026-11-18T08:00:00Z")]),
        now,
      ),
    ).toBeUndefined();
  });

  it("offers nothing without completions or while one is pending", () => {
    expect(undoable(h([]), now)).toBeUndefined();
    expect(
      undoable(h([c("pending:1", "2026-11-18T09:05:00Z")]), now),
    ).toBeUndefined();
    expect(undoable(h([c("pending:1", "")]), 0)).toBeUndefined();
  });

  it("shows it before hydration (now = 0); the server re-checks", () => {
    const last = c("c1", "2000-01-01T00:00:00Z");
    expect(undoable(h([last]), 0)).toBe(last);
  });
});

describe("TodayView", () => {
  it("renders the header: name, streak, balance and the level ring", () => {
    renderView(day({ streak_freezes: 2 }));
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByTestId("streak")).toHaveTextContent("3 days streak");
    expect(screen.getByTestId("balance")).toHaveTextContent("1,234 pts");
    expect(screen.getByText(/2 freezes/)).toBeInTheDocument();

    // 120 lifetime points: level 2 starts at 50, level 3 at 200.
    const ring = screen.getByRole("progressbar", { name: "Level 2 progress" });
    expect(ring).toHaveAttribute("aria-valuenow", "70");
    expect(ring).toHaveAttribute("aria-valuemin", "0");
    expect(ring).toHaveAttribute("aria-valuemax", "150");
    expect(ring).toHaveAttribute(
      "aria-valuetext",
      "Level 2: 70 of 150 points to the next level",
    );
    expect(ring).toHaveTextContent("2");
  });

  it("falls back to the username and singular units", () => {
    renderView(
      day({
        display_name: null,
        current_streak: 1,
        streak_freezes: 1,
        lifetime_points: 0,
      }),
    );
    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.getByTestId("streak")).toHaveTextContent("1 day streak");
    expect(screen.getByText(/1 freeze$/)).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Level 1 progress" }),
    ).toHaveAttribute(
      "aria-valuetext",
      "Level 1: 0 of 50 points to the next level",
    );
  });

  it("names each habit card for screen readers and shows pips", () => {
    renderView(
      day({
        habits: [
          habit("h1", "Read", {
            done: 1,
            habit_streak: 4,
            completions: [completion("c1", 1)],
          }),
          habit("h2", "Drink water", { target: 3, done: 1, habit_streak: 1 }),
          habit("h3", "Stretch"),
        ],
      }),
    );
    expect(
      screen.getByRole("heading", { name: "1 of 3 done" }),
    ).toBeInTheDocument();
    const read = screen.getByRole("button", {
      name: "Read, done for today, 4 days streak",
    });
    expect(read).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", {
        name: "Complete Drink water, 1 of 3 done, 1 day streak",
      }),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      screen.getByRole("button", { name: "Complete Stretch, 0 of 1 done" }),
    ).toBeInTheDocument();

    // Pips only for multi-target habits, one filled per completion.
    const pips = within(card("h2")).getByTestId("pips").children;
    expect(pips).toHaveLength(3);
    expect([...pips].map((p) => p.className.includes("bg-success"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(within(card("h3")).queryByTestId("pips")).toBeNull();
  });

  it("completes optimistically, then adopts the server's snapshot", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    completeHabit.mockReturnValue(new Promise((r) => (resolve = r)));
    renderView(day());

    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    expect(completeHabit).toHaveBeenCalledWith("h1");
    // Before the server answers: done, but no points or streak invented.
    expect(
      screen.getByRole("button", { name: "Read, done for today" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 of 2 done" })).toBeVisible();
    expect(screen.getByTestId("balance")).toHaveTextContent("1,234 pts");
    // A pending completion can't be undone yet.
    expect(screen.queryByRole("button", { name: "Undo Read" })).toBeNull();

    const fresh = day({
      points_balance: 1246,
      lifetime_points: 132,
      current_streak: 4,
      habits: [
        habit("h1", "Read", {
          done: 1,
          habit_streak: 1,
          completions: [completion("c-new", 1)],
        }),
        habit("h2", "Drink water", { target: 3, habit_streak: 2 }),
      ],
    });
    await act(async () => resolve({ ok: true, event: event(), today: fresh }));

    expect(screen.getByTestId("balance")).toHaveTextContent("1,246 pts");
    expect(screen.getByTestId("streak")).toHaveTextContent("4 days streak");
    expect(
      screen.getByRole("button", {
        name: "Read, done for today, 1 day streak",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo Read" })).toBeVisible();
    expect(within(card("h1")).getByText(`+12 ${TIMES}1.20`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(live()).toHaveTextContent(
      "Read: 1 of 1 done. +12 points. 4-day streak.",
    );
    expect(screen.queryByTestId("confetti")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("removes the floating points text after a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    completeHabit.mockResolvedValue({ ok: true, event: event(), today: null });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    expect(await screen.findByText(`+12 ${TIMES}1.20`)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1_300));
    expect(screen.queryByText(`+12 ${TIMES}1.20`)).toBeNull();
  });

  it("stacks rapid taps on a multi-target habit without passing the target", async () => {
    const user = userEvent.setup();
    completeHabit.mockImplementation(hang);
    renderView(day());
    const name = (n: number) =>
      `Complete Drink water, ${n} of 3 done, 2 days streak`;
    await user.click(screen.getByRole("button", { name: name(0) }));
    await user.click(screen.getByRole("button", { name: name(1) }));
    await user.click(screen.getByRole("button", { name: name(2) }));
    expect(
      screen.getByRole("button", {
        name: "Drink water, done for today, 2 days streak",
      }),
    ).toBeInTheDocument();
    // A fourth tap on a done card is ignored, not sent.
    await user.click(
      screen.getByRole("button", {
        name: "Drink water, done for today, 2 days streak",
      }),
    );
    expect(completeHabit).toHaveBeenCalledTimes(3);
  });

  it("refreshes when the action returns no snapshot", async () => {
    const user = userEvent.setup();
    completeHabit.mockResolvedValue({ ok: true, event: event(), today: null });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // The event's streak is announced when there's no snapshot.
    expect(live()).toHaveTextContent("4-day streak.");
  });

  it("celebrates a milestone with confetti, a toast and an announcement", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    completeHabit.mockResolvedValue({
      ok: true,
      event: event({ current_streak: 7, milestone: 7, milestone_points: 50 }),
      today: day({ current_streak: 7 }),
    });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );

    const confetti = await screen.findByTestId("confetti");
    expect(confetti).toHaveAttribute("aria-hidden", "true");
    expect(await screen.findByText("7-day streak!")).toBeInTheDocument();
    expect(screen.getByText("+50 bonus points")).toBeInTheDocument();
    expect(live()).toHaveTextContent(
      "Read: 1 of 1 done. +12 points. 7-day streak. 7-day milestone, +50 bonus points!",
    );

    // The burst clears itself.
    await act(async () => vi.advanceTimersByTime(2_600));
    expect(screen.queryByTestId("confetti")).toBeNull();
  });

  it("shows a refusal, reverts, and refreshes when the screen is stale", async () => {
    const user = userEvent.setup();
    completeHabit.mockResolvedValue({
      ok: false,
      code: "not_today",
      error: "That habit isn't scheduled today.",
    });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That habit isn't scheduled today.",
    );
    expect(live()).toHaveTextContent("Couldn't complete Read.");
    expect(refresh).toHaveBeenCalledTimes(1);
    // The optimistic completion is rolled back.
    expect(
      await screen.findByRole("button", { name: "Complete Read, 0 of 1 done" }),
    ).toBeInTheDocument();
  });

  it("treats a raced double tap (done) as benign: no alert, just a refresh", async () => {
    const user = userEvent.setup();
    completeHabit.mockResolvedValue({
      ok: false,
      code: "done",
      error: "Already done for today.",
    });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(live()).toHaveTextContent("Read is already done for today.");
  });

  it("keeps a saved completion whose event was unreadable", async () => {
    const user = userEvent.setup();
    const next = day({
      habits: [
        habit("h1", "Read", { done: 1, completions: [completion("c9", 1)] }),
      ],
    });
    completeHabit.mockResolvedValue({ ok: true, event: null, today: next });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    expect(
      await screen.findByRole("button", { name: "Read, done for today" }),
    ).toBeInTheDocument();
    expect(live()).toHaveTextContent("Read saved.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the points without a multiplier when there is no bonus", async () => {
    const user = userEvent.setup();
    completeHabit.mockResolvedValue({
      ok: true,
      event: event({ multiplier: 1, points_awarded: 20 }),
      today: day(),
    });
    renderView(day());
    await user.click(
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
    );
    expect(await screen.findByText("+20")).toBeInTheDocument();
    expect(screen.queryByText(/×1\.00/)).toBeNull();
  });

  it("marks a habit that joined today as counting from tomorrow (#82)", () => {
    renderView(
      day({
        habits: [
          habit("h1", "Read"),
          habit("h2", "New", { joined_late: true }),
        ],
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Complete New, 0 of 1 done, counts toward your streak from tomorrow",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Streak from tomorrow")).toHaveLength(1);
  });

  it("explains a relived day (#81) and says nothing on a normal one", () => {
    const { unmount } = renderView(day());
    expect(screen.queryByText(/previous timezone/)).toBeNull();
    unmount();
    renderView(day({ relived: true }));
    expect(
      screen.getByText(/already passed this day in your previous timezone/),
    ).toBeInTheDocument();
  });

  it("offers Restore when today's habits were archived (not at risk)", () => {
    renderView(day({ habits: [], scheduled_count: 2 }));
    expect(
      screen.getByRole("link", { name: "Restore a habit" }),
    ).toHaveAttribute("href", "/habits");
  });

  it("refreshes once the local date rolls over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-18T23:59:30Z"));
    renderView(
      day({ local_date: "2026-11-18", local_hour: 23, timezone: "UTC" }),
    );
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    // A focus right after doesn't refresh again (throttled)...
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    // ...but if the server still sent yesterday (device clock fast, or the
    // refresh failed), it retries a minute later.
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops once the server's snapshot has caught up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-19T00:00:30Z"));
    renderView(
      day({ local_date: "2026-11-19", local_hour: 0, timezone: "UTC" }),
    );
    await act(async () => vi.advanceTimersByTime(180_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("doesn't refresh when the device clock is behind the snapshot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-18T23:58:00Z"));
    renderView(
      day({ local_date: "2026-11-19", local_hour: 0, timezone: "UTC" }),
    );
    await act(async () => vi.advanceTimersByTime(60_000));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("doesn't refresh while the page is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-19T08:00:00Z"));
    const vis = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    renderView(
      day({ local_date: "2026-11-18", local_hour: 23, timezone: "UTC" }),
    );
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(refresh).not.toHaveBeenCalled();
    vis.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    vis.mockRestore();
  });

  it("refreshes at 18:00 so the at-risk banner can appear", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-18T17:59:30Z"));
    renderView(
      day({ local_date: "2026-11-18", local_hour: 17, timezone: "UTC" }),
    );
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the app comes back on a new day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-19T08:00:00Z"));
    renderView(
      day({ local_date: "2026-11-18", local_hour: 23, timezone: "UTC" }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["not_found", "not_today", "too_late"])(
    "refreshes on stale code %s",
    async (code) => {
      const user = userEvent.setup();
      completeHabit.mockResolvedValue({ ok: false, code, error: "Nope." });
      renderView(day());
      await user.click(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      );
      await screen.findByRole("alert");
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["failed", "signed_out", "not_onboarded", "no_balance"])(
    "does not refresh on %s",
    async (code) => {
      const user = userEvent.setup();
      completeHabit.mockResolvedValue({ ok: false, code, error: "Nope." });
      renderView(day());
      await user.click(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      );
      await screen.findByRole("alert");
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("clears the error on the next attempt", async () => {
    const user = userEvent.setup();
    completeHabit.mockResolvedValueOnce({
      ok: false,
      code: "failed",
      error: "Couldn't save. Try again.",
    });
    completeHabit.mockImplementationOnce(hang);
    renderView(day());
    const button = () =>
      screen.getByRole("button", { name: "Complete Read, 0 of 1 done" });
    await user.click(button());
    await screen.findByRole("alert");
    await user.click(await vi.waitFor(button));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("undo", () => {
    const withCompletion = (until: string) =>
      day({
        habits: [
          habit("h1", "Read", {
            done: 1,
            completions: [completion("c1", 1, { undoable_until: until })],
          }),
        ],
      });

    it("is offered for the latest completion inside the window", () => {
      renderView(withCompletion(at(4 * MIN)));
      expect(
        screen.getByRole("button", { name: "Undo Read" }),
      ).toBeInTheDocument();
    });

    it("is hidden once the window has passed", () => {
      // Past by more than one 5 s tick of the coarse clock.
      renderView(withCompletion(at(-6_000)));
      expect(screen.queryByRole("button", { name: "Undo Read" })).toBeNull();
    });

    it("disappears when the window closes while on screen", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T09:00:00Z"));
      renderView(withCompletion("2026-11-18T09:00:07Z"));
      expect(screen.getByRole("button", { name: "Undo Read" })).toBeVisible();
      await act(async () => vi.advanceTimersByTime(5_000));
      // 09:00:05 < 09:00:07: still open.
      expect(screen.getByRole("button", { name: "Undo Read" })).toBeVisible();
      await act(async () => vi.advanceTimersByTime(5_000));
      expect(screen.queryByRole("button", { name: "Undo Read" })).toBeNull();
    });

    it("undoes optimistically, then adopts the snapshot and announces points lost", async () => {
      const user = userEvent.setup();
      let resolve!: (v: unknown) => void;
      undoCompletion.mockReturnValue(new Promise((r) => (resolve = r)));
      renderView(withCompletion(at(4 * MIN)));

      await user.click(screen.getByRole("button", { name: "Undo Read" }));
      expect(undoCompletion).toHaveBeenCalledWith("c1");
      expect(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Undo Read" })).toBeNull();

      await act(async () =>
        resolve({
          ok: true,
          event: undoEvent({
            points_removed: 10,
            milestone_points_removed: 50,
          }),
          today: day({
            points_balance: 1174,
            habits: [habit("h1", "Read")],
          }),
        }),
      );
      expect(screen.getByTestId("balance")).toHaveTextContent("1,174 pts");
      expect(live()).toHaveTextContent(`Undid Read. ${MINUS}60 points.`);
      expect(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      ).toBeInTheDocument();
    });

    it("uses the singular for one point", async () => {
      const user = userEvent.setup();
      undoCompletion.mockResolvedValue({
        ok: true,
        event: undoEvent({ points_removed: 1 }),
        today: day({ habits: [habit("h1", "Read")] }),
      });
      renderView(withCompletion(at(4 * MIN)));
      await user.click(screen.getByRole("button", { name: "Undo Read" }));
      await vi.waitFor(() =>
        expect(live()).toHaveTextContent(`Undid Read. ${MINUS}1 point.`),
      );
    });

    it("restores the completion and shows why when refused", async () => {
      const user = userEvent.setup();
      undoCompletion.mockResolvedValue({
        ok: false,
        code: "no_balance",
        error: "You've already spent those points, so this can't be undone.",
      });
      renderView(withCompletion(at(4 * MIN)));
      await user.click(screen.getByRole("button", { name: "Undo Read" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "already spent those points",
      );
      expect(live()).toHaveTextContent("Couldn't undo Read.");
      expect(refresh).not.toHaveBeenCalled();
      expect(
        await screen.findByRole("button", { name: "Read, done for today" }),
      ).toBeInTheDocument();
    });

    it("refreshes when the window has passed on the server", async () => {
      const user = userEvent.setup();
      undoCompletion.mockResolvedValue({
        ok: false,
        code: "too_late",
        error: "The undo window has passed.",
      });
      renderView(withCompletion(at(4 * MIN)));
      await user.click(screen.getByRole("button", { name: "Undo Read" }));
      await screen.findByRole("alert");
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("empty and at-risk states", () => {
    it("offers add and restore when today's habits were archived", () => {
      renderView(day({ at_risk: true, habits: [], scheduled_count: 1 }));
      const banner = screen.getByTestId("at-risk");
      expect(banner).toHaveTextContent("Your 3 days streak is at risk");
      expect(
        within(banner).getByRole("link", { name: "Add a habit" }),
      ).toHaveAttribute("href", "/habits/new");
      expect(
        within(banner).getByRole("link", { name: "Restore a habit" }),
      ).toHaveAttribute("href", "/habits");
      // No second "Add a habit" from the empty card.
      expect(screen.getAllByRole("link", { name: "Add a habit" })).toHaveLength(
        1,
      );
    });

    it("warns without links when habits remain", () => {
      renderView(day({ at_risk: true }));
      const banner = screen.getByTestId("at-risk");
      expect(banner).toHaveTextContent(
        "Complete any habit before midnight to keep it.",
      );
      expect(within(banner).queryByRole("link")).toBeNull();
    });

    it("shows a rest day when nothing is scheduled", () => {
      renderView(day({ habits: [], scheduled_count: 0 }));
      expect(screen.queryByTestId("at-risk")).toBeNull();
      expect(
        screen.getByText("Rest day: nothing is scheduled today."),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add a habit" })).toHaveAttribute(
        "href",
        "/habits/new",
      );
      expect(screen.queryByRole("heading")).toBeNull();
    });

    it("explains when the next completion spends freezes", () => {
      const { rerender } = renderView(day({ freezes_needed: 2 }));
      expect(
        screen.getByText(
          "Your next completion uses 2 streak freezes to keep your streak.",
        ),
      ).toBeInTheDocument();
      // No streak to keep: no note.
      rerender(day({ freezes_needed: 2, current_streak: 0 }));
      expect(screen.queryByText(/streak freeze/)).toBeNull();
    });
  });

  it("replaces the view when the server renders a new snapshot", () => {
    const { rerender } = renderView(day());
    rerender(day({ points_balance: 5, habits: [habit("h9", "Walk")] }));
    expect(screen.getByTestId("balance")).toHaveTextContent("5 pts");
    expect(
      screen.getByRole("button", { name: "Complete Walk, 0 of 1 done" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Read")).toBeNull();
  });

  describe("keyboard", () => {
    it("completes with Enter and Space from Tab focus", async () => {
      const user = userEvent.setup();
      completeHabit.mockImplementation(hang);
      renderView(day());

      await user.tab();
      expect(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      ).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(completeHabit).toHaveBeenLastCalledWith("h1");
      // Focus stays on the card, now done.
      expect(
        screen.getByRole("button", { name: "Read, done for today" }),
      ).toHaveFocus();

      await user.tab();
      expect(
        screen.getByRole("button", {
          name: "Complete Drink water, 0 of 3 done, 2 days streak",
        }),
      ).toHaveFocus();
      await user.keyboard(" ");
      expect(completeHabit).toHaveBeenLastCalledWith("h2");
      expect(completeHabit).toHaveBeenCalledTimes(2);
    });

    it("reaches the undo button by Tab and undoes with Enter", async () => {
      const user = userEvent.setup();
      undoCompletion.mockImplementation(hang);
      renderView(
        day({
          habits: [
            habit("h1", "Read", {
              done: 1,
              completions: [completion("c1", 1)],
            }),
          ],
        }),
      );
      await user.tab();
      await user.tab();
      expect(screen.getByRole("button", { name: "Undo Read" })).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(undoCompletion).toHaveBeenCalledWith("c1");
      // Undo disappears; focus lands on the card, not <body>.
      expect(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      ).toHaveFocus();
    });

    it("moves focus to the card when a focused Undo's window closes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderView(
        day({
          habits: [
            habit("h1", "Read", {
              done: 1,
              completions: [completion("c1", 1, { undoable_until: at(2_000) })],
            }),
          ],
        }),
      );
      screen.getByRole("button", { name: "Undo Read" }).focus();
      await act(async () => vi.advanceTimersByTime(3_000));
      expect(screen.queryByRole("button", { name: "Undo Read" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Read, done for today" }),
      ).toHaveFocus();
    });
  });

  it("announces the streak and revoked milestones after an undo", async () => {
    const user = userEvent.setup();
    undoCompletion.mockResolvedValue({
      ok: true,
      event: undoEvent({
        points_removed: 10,
        milestones_revoked: [3],
        milestone_points_removed: 25,
      }),
      today: day({ current_streak: 2 }),
    });
    renderView(
      day({
        habits: [
          habit("h1", "Read", { done: 1, completions: [completion("c1", 1)] }),
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo Read" }));
    await vi.waitFor(() =>
      expect(live()).toHaveTextContent(
        "Undid Read. " +
          MINUS +
          "35 points. 3-day milestone removed. 2-day streak.",
      ),
    );
  });

  describe("offline", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("says you're offline without calling the action", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const user = userEvent.setup();
      renderView(day());
      await user.click(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You're offline",
      );
      expect(completeHabit).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(
        await screen.findByRole("button", {
          name: "Complete Read, 0 of 1 done",
        }),
      ).toBeInTheDocument();
    });

    it("turns a failed request into a message and reverts", async () => {
      completeHabit.mockRejectedValue(new TypeError("Failed to fetch"));
      const user = userEvent.setup();
      renderView(day());
      await user.click(
        screen.getByRole("button", { name: "Complete Read, 0 of 1 done" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't confirm that saved. Checking…",
      );
      // The response may have been lost after the write committed.
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByRole("button", {
          name: "Complete Read, 0 of 1 done",
        }),
      ).toBeInTheDocument();
    });
  });
});
