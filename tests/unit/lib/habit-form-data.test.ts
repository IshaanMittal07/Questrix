// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Habit } from "@/lib/habits/queries";

vi.mock("server-only", () => ({}));

const listActiveHabits = vi.fn();
const listArchivedHabits = vi.fn();
vi.mock("@/lib/habits/queries", () => ({
  listActiveHabits: () => listActiveHabits(),
  listArchivedHabits: () => listArchivedHabits(),
}));
const getMyProfile = vi.fn();
vi.mock("@/lib/profile/queries", () => ({
  getMyProfile: () => getMyProfile(),
}));
const suggestHabits = vi.fn();
vi.mock("@/lib/habits/suggestions", () => ({
  suggestHabits: (...a: unknown[]) => suggestHabits(...a),
}));

const {
  coachingContext,
  suggestionsForMe,
  toFormValues,
  toListItem,
  SUGGESTIONS_SHOWN,
} = await import("@/lib/habits/form-data");

const habit = (id: string, over: Partial<Habit> = {}): Habit => ({
  id,
  title: `Habit ${id}`,
  description: null,
  icon: null,
  category: "health",
  difficulty: "medium",
  color: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  target_per_day: 1,
  reminder_times: [],
  reminders_enabled: true,
  sort_order: 0,
  template_key: null,
  archived_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  listActiveHabits.mockReset().mockResolvedValue([]);
  listArchivedHabits.mockReset().mockResolvedValue([]);
  getMyProfile.mockReset().mockResolvedValue(null);
  suggestHabits.mockReset().mockReturnValue([]);
});

describe("toFormValues", () => {
  it("trims reminder times to HH:MM and turns null text into empty strings", () => {
    expect(
      toFormValues(
        habit("a", {
          title: "Read",
          category: "learning",
          difficulty: "hard",
          color: "violet",
          days_of_week: [1, 3],
          target_per_day: 2,
          reminder_times: ["07:15:00", "21:30:59"],
          reminders_enabled: false,
        }),
      ),
    ).toEqual({
      title: "Read",
      description: "",
      icon: "",
      category: "learning",
      difficulty: "hard",
      color: "violet",
      days_of_week: [1, 3],
      target_per_day: 2,
      reminder_times: ["07:15", "21:30"],
      reminders_enabled: false,
    });
  });

  it("keeps a description, icon and already-short times", () => {
    const v = toFormValues(
      habit("a", {
        description: "Before bed",
        icon: "📖",
        reminder_times: ["09:00"],
      }),
    );
    expect(v.description).toBe("Before bed");
    expect(v.icon).toBe("📖");
    expect(v.reminder_times).toEqual(["09:00"]);
    expect(v.color).toBeNull();
  });
});

describe("suggestionsForMe", () => {
  it("passes active and archived habits to the suggester and maps the top ones", async () => {
    const active = [habit("a")];
    const archived = [habit("z", { archived_at: "2026-11-02T00:00:00.000Z" })];
    listActiveHabits.mockResolvedValue(active);
    listArchivedHabits.mockResolvedValue(archived);
    suggestHabits.mockReturnValue(
      Array.from({ length: SUGGESTIONS_SHOWN + 2 }, (_, i) => ({
        template: { key: `t${i}` },
        reasons: ["category_gap"],
        ...(i === 0 && { pairedWith: "Workout" }),
      })),
    );

    const suggestions = await suggestionsForMe();

    expect(suggestHabits).toHaveBeenCalledWith([...active, ...archived]);
    expect(suggestions).toHaveLength(SUGGESTIONS_SHOWN);
    expect(suggestions[0]).toEqual({
      key: "t0",
      reasons: ["category_gap"],
      pairedWith: "Workout",
    });
    // No pairedWith key at all, not `pairedWith: undefined`.
    expect(suggestions[1]).toEqual({ key: "t1", reasons: ["category_gap"] });
    expect("pairedWith" in suggestions[1]).toBe(false);
  });
});

describe("coachingContext", () => {
  it("leaves the edited habit out of coaching and keeps archived ones out", async () => {
    listActiveHabits.mockResolvedValue([
      habit("a", { title: "Alpha", reminder_times: ["09:00:00"] }),
      habit("b", { title: "Bravo", reminder_times: ["10:00:00"] }),
    ]);
    listArchivedHabits.mockResolvedValue([
      habit("z", { title: "Zulu", archived_at: "2026-11-02T00:00:00.000Z" }),
    ]);

    const coaching = await coachingContext("a");

    expect(coaching.activeHabits).toEqual([
      { title: "Bravo", reminder_times: ["10:00:00"] },
    ]);
    // Archived habits never count towards coaching.
    expect(listArchivedHabits).not.toHaveBeenCalled();
  });

  it("includes every active habit when nothing is being edited", async () => {
    listActiveHabits.mockResolvedValue([habit("a"), habit("b")]);
    const coaching = await coachingContext();
    expect(coaching.activeHabits.map((h) => h.title)).toEqual([
      "Habit a",
      "Habit b",
    ]);
  });

  it("passes onboarded_at from the profile and a server-side now", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-17T12:00:00.000Z") });
    try {
      getMyProfile.mockResolvedValue({
        profile: { onboarded_at: "2026-11-16T08:00:00.000Z" },
      });
      const coaching = await coachingContext();
      expect(coaching.onboardedAt).toBe("2026-11-16T08:00:00.000Z");
      expect(coaching.now).toBe("2026-11-17T12:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses null onboardedAt with no profile or no onboarding date", async () => {
    getMyProfile.mockResolvedValue(null);
    expect((await coachingContext()).onboardedAt).toBeNull();
    getMyProfile.mockResolvedValue({ profile: { onboarded_at: null } });
    expect((await coachingContext()).onboardedAt).toBeNull();
  });
});

describe("toListItem", () => {
  it("sends only what the list renders to the client", () => {
    const h = habit("a", {
      icon: "*",
      color: "cyan",
      description: "private notes",
      template_key: "read",
      reminder_times: ["09:00:00"],
    });
    expect(toListItem(h)).toEqual({
      id: "a",
      title: "Habit a",
      icon: "*",
      color: "cyan",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      target_per_day: 1,
      reminder_times: ["09:00:00"],
      reminders_enabled: true,
    });
  });
});
