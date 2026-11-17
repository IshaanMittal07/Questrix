// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * A fake supabase-js client: every builder call is recorded, and awaiting the
 * chain (or .single()/.maybeSingle()) resolves to the next queued result.
 */
type Result = { data?: unknown; error?: unknown };
const calls: Array<[string, ...unknown[]]> = [];
let results: Result[] = [];
let userId: string | null = "u1";

function chain(): unknown {
  const settle = () => {
    const r = results.shift() ?? {};
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === "then") {
          const p = settle();
          return p.then.bind(p);
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => {
            calls.push([prop]);
            return settle();
          };
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : null,
      }),
    },
    from: (table: string) => {
      calls.push(["from", table]);
      return chain();
    },
    rpc: (fn: string, args: unknown) => {
      calls.push(["rpc", fn, args]);
      const r = results.shift() ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  }),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const actions = await import("@/lib/habits/actions");
const { getTemplate } = await import("@/lib/habits/templates");

const ID = "3f1c2a4e-8b7d-4c6e-9a1f-2b3c4d5e6f70";
const ID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const valid = {
  title: "  Read 20 pages ",
  category: "learning",
  reminder_times: ["21:00:00", "07:30"],
  days_of_week: [3, 1, 1],
};

const op = (name: string) => calls.find((c) => c[0] === name);

beforeEach(() => {
  calls.length = 0;
  results = [];
  userId = "u1";
  revalidatePath.mockReset();
});

describe("createHabit", () => {
  it("inserts the parsed output, not the raw input", async () => {
    results = [{ data: { id: ID } }];
    const res = await actions.createHabit(valid);
    expect(res).toEqual({ ok: true, data: { id: ID } });
    expect(op("from")).toEqual(["from", "habits"]);
    expect(op("insert")?.[1]).toEqual({
      title: "Read 20 pages",
      category: "learning",
      difficulty: "medium",
      days_of_week: [1, 3],
      target_per_day: 1,
      reminder_times: ["07:30", "21:00"],
      reminders_enabled: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/habits");
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });

  it("rejects server-owned fields without touching the database", async () => {
    for (const extra of [
      { user_id: "u2" },
      { sort_order: 0 },
      { archived_at: "2026-01-01" },
    ]) {
      const res = await actions.createHabit({ ...valid, ...extra });
      expect(res).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(calls).toEqual([]);
  });

  it("names the invalid field", async () => {
    const res = await actions.createHabit({ ...valid, title: "   " });
    expect(res).toEqual({
      ok: false,
      code: "invalid",
      error: "Give your habit a name",
      field: "title",
    });
  });

  it("rejects FormData-style strings instead of coercing them", async () => {
    const res = await actions.createHabit({ ...valid, target_per_day: "2" });
    expect(res).toMatchObject({ ok: false, field: "target_per_day" });
  });

  it("refuses when signed out", async () => {
    userId = null;
    expect(await actions.createHabit(valid)).toMatchObject({
      ok: false,
      code: "signed_out",
    });
    expect(op("insert")).toBeUndefined();
  });

  it("maps the 20-habit cap", async () => {
    results = [
      {
        error: {
          code: "23514",
          message: "You can have at most 20 active habits",
        },
      },
    ];
    expect(await actions.createHabit(valid)).toMatchObject({
      ok: false,
      code: "at_cap",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps other check violations without leaking SQL text", async () => {
    results = [
      {
        error: {
          code: "23514",
          message: 'new row violates check constraint "habits_title_length"',
        },
      },
    ];
    expect(await actions.createHabit(valid)).toEqual({
      ok: false,
      code: "invalid",
      error: "Check the habit's details.",
    });
  });

  it("passes the trigger's rate-limit message and hint through", async () => {
    results = [
      {
        error: {
          code: "QX001",
          message: "You can create at most 30 habits a day",
          hint: "Try again later.",
        },
      },
    ];
    expect(await actions.createHabit(valid)).toEqual({
      ok: false,
      code: "rate_limited",
      error: "You can create at most 30 habits a day. Try again later.",
    });
  });

  it("maps unknown errors to a generic failure", async () => {
    results = [{ error: { code: "XX000", message: "boom" } }];
    expect(await actions.createHabit(valid)).toEqual({
      ok: false,
      code: "failed",
      error: "Couldn't save. Try again.",
    });
  });
});

describe("updateHabit", () => {
  it("updates only the given fields, scoped to the user", async () => {
    results = [{ data: { id: ID } }];
    const res = await actions.updateHabit(ID.toUpperCase(), {
      title: " Read 30 pages",
      reminder_times: undefined,
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(op("update")?.[1]).toEqual({ title: "Read 30 pages" });
    expect(calls.filter((c) => c[0] === "eq")).toEqual([
      ["eq", "id", ID],
      ["eq", "user_id", "u1"],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/habits");
  });

  it("can't change template_key or server-owned fields", async () => {
    for (const patch of [
      { template_key: "workout" },
      { sort_order: 1 },
      { archived_at: null },
      { user_id: "u2" },
    ]) {
      expect(await actions.updateHabit(ID, patch)).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
    expect(calls).toEqual([]);
  });

  it("rejects an empty patch", async () => {
    expect(await actions.updateHabit(ID, {})).toMatchObject({
      ok: false,
      error: "Nothing to update",
    });
  });

  it("treats a malformed id as not found", async () => {
    expect(await actions.updateHabit("nope", { title: "x" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(calls).toEqual([]);
  });

  it("reports not found when RLS hides the row", async () => {
    results = [{ data: null }];
    expect(await actions.updateHabit(ID, { title: "x" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("archive / unarchive", () => {
  it.each([
    ["archiveHabit", "archive_habit"],
    ["unarchiveHabit", "unarchive_habit"],
  ] as const)("%s calls %s with the lowercased id", async (name, fn) => {
    const res = await actions[name](ID.toUpperCase());
    expect(res).toEqual({ ok: true, data: undefined });
    expect(op("rpc")).toEqual(["rpc", fn, { p_habit_id: ID }]);
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });

  it("maps P0002 to not found", async () => {
    results = [{ error: { code: "P0002", message: "Habit not found" } }];
    expect(await actions.archiveHabit(ID)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("maps the cap on unarchive", async () => {
    results = [
      {
        error: {
          code: "23514",
          message: "You can have at most 20 active habits",
        },
      },
    ];
    expect(await actions.unarchiveHabit(ID)).toMatchObject({ code: "at_cap" });
  });

  it("refuses a malformed id or a signed-out user", async () => {
    expect(await actions.archiveHabit(42)).toMatchObject({
      code: "not_found",
    });
    userId = null;
    expect(await actions.archiveHabit(ID)).toMatchObject({
      code: "signed_out",
    });
    expect(op("rpc")).toBeUndefined();
  });
});

describe("reorderHabits", () => {
  it("sends the full order", async () => {
    expect(await actions.reorderHabits([ID2, ID])).toEqual({
      ok: true,
      data: undefined,
    });
    expect(op("rpc")).toEqual([
      "rpc",
      "reorder_habits",
      { p_habit_ids: [ID2, ID] },
    ]);
  });

  it("rejects duplicates, empty and oversized lists locally", async () => {
    expect(await actions.reorderHabits([ID, ID])).toMatchObject({
      code: "invalid",
    });
    expect(await actions.reorderHabits([])).toMatchObject({ code: "invalid" });
    expect(await actions.reorderHabits("x")).toMatchObject({ code: "invalid" });
    expect(op("rpc")).toBeUndefined();
  });

  it("maps a stale order", async () => {
    results = [{ error: { code: "22023", message: "The order must list…" } }];
    expect(await actions.reorderHabits([ID])).toMatchObject({
      code: "stale",
    });
  });
});

describe("addStarterHabits", () => {
  it("builds every field from the template library", async () => {
    const res = await actions.addStarterHabits(["workout", "drink_water"]);
    expect(res).toEqual({ ok: true, data: { count: 2 } });
    const rows = op("insert")?.[1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const water = getTemplate("drink_water")!;
    // Strict: every row must have the same keys, or postgrest-js's ?columns=
    // union would send NULL instead of a column default for missing ones.
    expect(rows[1]).toStrictEqual({
      title: water.title,
      category: water.category,
      difficulty: water.difficulty,
      icon: water.icon,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      target_per_day: 4,
      reminder_times: ["09:00", "12:00", "15:00", "18:00"],
      reminders_enabled: true,
      template_key: "drink_water",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/habits");
  });

  it("is a no-op for Skip (an empty list)", async () => {
    expect(await actions.addStarterHabits([])).toEqual({
      ok: true,
      data: { count: 0 },
    });
    expect(calls).toEqual([]);
  });

  it.each([
    [["workout", "stretch", "floss", "meditate"], "Pick at most 3 habits"],
    [["workout", "workout"], "Duplicate habit"],
    [["workout", "nope"], "Unknown habit template"],
    [[{ title: "Evil", category: "health" }], undefined],
    ["workout", undefined],
  ])("rejects %j", async (keys, message) => {
    const res = await actions.addStarterHabits(keys);
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (message) expect(res).toMatchObject({ error: message });
    expect(calls).toEqual([]);
  });

  it("refuses when signed out", async () => {
    userId = null;
    expect(await actions.addStarterHabits(["workout"])).toMatchObject({
      code: "signed_out",
    });
    expect(op("insert")).toBeUndefined();
  });

  it("maps database errors", async () => {
    results = [{ error: { code: "QX001", message: "Slow down" } }];
    expect(await actions.addStarterHabits(["workout"])).toEqual({
      ok: false,
      code: "rate_limited",
      error: "Slow down.",
    });
  });
});

describe("edge cases", () => {
  it("createHabit keeps a library template_key and rejects unknown ones", async () => {
    results = [{ data: { id: ID } }];
    await actions.createHabit({ ...valid, template_key: "workout" });
    expect(op("insert")?.[1]).toMatchObject({ template_key: "workout" });
    calls.length = 0;
    expect(
      await actions.createHabit({ ...valid, template_key: "not_in_library" }),
    ).toEqual({
      ok: false,
      code: "invalid",
      error: "Unknown habit template",
      field: "template_key",
    });
    expect(calls).toEqual([]);
  });

  it("never names an array index as the invalid field", async () => {
    const res = await actions.reorderHabits([ID, "nope"]);
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    expect(res).not.toHaveProperty("field");
    expect(await actions.addStarterHabits(["workout", 1])).not.toHaveProperty(
      "field",
    );
  });

  it("doesn't double a period in the rate-limit message", async () => {
    results = [
      { error: { code: "QX001", message: "Slow down.", hint: "Later." } },
    ];
    expect(await actions.createHabit(valid)).toMatchObject({
      error: "Slow down. Later.",
    });
  });

  it.each(["Workout", "../x", "", "a".repeat(41), 7])(
    "createHabit rejects a malformed template_key %j",
    async (template_key) => {
      expect(
        await actions.createHabit({ ...valid, template_key }),
      ).toMatchObject({ ok: false, code: "invalid", field: "template_key" });
      expect(calls).toEqual([]);
    },
  );

  it("omits field for a root-level validation error", async () => {
    for (const input of [null, "x", [valid]]) {
      const res = await actions.createHabit(input);
      expect(res).toMatchObject({ ok: false, code: "invalid" });
      expect(res).not.toHaveProperty("field");
    }
    expect(calls).toEqual([]);
  });

  it("maps 28000 to signed out", async () => {
    results = [{ error: { code: "28000", message: "Not signed in" } }];
    expect(await actions.createHabit(valid)).toEqual({
      ok: false,
      code: "signed_out",
      error: "You're signed out.",
    });
  });

  it("falls back to a default rate-limit message with no hint", async () => {
    results = [{ error: { code: "QX001" } }];
    expect(await actions.createHabit(valid)).toEqual({
      ok: false,
      code: "rate_limited",
      error: "Too many new habits.",
    });
  });

  it("treats a 23514 without a message as invalid, not at_cap", async () => {
    results = [{ error: { code: "23514" } }];
    expect(await actions.createHabit(valid)).toMatchObject({
      code: "invalid",
    });
  });

  it("updateHabit refuses when signed out without writing", async () => {
    userId = null;
    expect(await actions.updateHabit(ID, { title: "x" })).toMatchObject({
      code: "signed_out",
    });
    expect(op("update")).toBeUndefined();
  });

  it("updateHabit maps a database error and doesn't revalidate", async () => {
    results = [{ error: { code: "XX000", message: "relation habits..." } }];
    expect(await actions.updateHabit(ID, { title: "x" })).toEqual({
      ok: false,
      code: "failed",
      error: "Couldn't save. Try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updateHabit names the invalid field after a valid id", async () => {
    expect(await actions.updateHabit(ID, { target_per_day: 6 })).toMatchObject({
      code: "invalid",
      field: "target_per_day",
    });
    expect(calls).toEqual([]);
  });

  it("archive failures don't revalidate", async () => {
    results = [{ error: { code: "P0002" } }];
    await actions.archiveHabit(ID);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reorderHabits refuses when signed out", async () => {
    userId = null;
    expect(await actions.reorderHabits([ID])).toMatchObject({
      code: "signed_out",
    });
    expect(op("rpc")).toBeUndefined();
  });

  it("reorderHabits rejects more than 20 ids and malformed ids", async () => {
    const many = Array.from(
      { length: 21 },
      (_, i) => `3f1c2a4e-8b7d-4c6e-9a1f-${i.toString(16).padStart(12, "0")}`,
    );
    expect(await actions.reorderHabits(many)).toMatchObject({
      code: "invalid",
      error: "At most 20 habits",
    });
    expect(await actions.reorderHabits([ID, "nope"])).toMatchObject({
      code: "invalid",
    });
    expect(op("rpc")).toBeUndefined();
  });

  it("reorderHabits treats case variants of one id as duplicates", async () => {
    expect(await actions.reorderHabits([ID, ID.toUpperCase()])).toMatchObject({
      code: "invalid",
      error: "Duplicate habit",
    });
    expect(op("rpc")).toBeUndefined();
  });

  it("reorderHabits sends lowercased ids", async () => {
    await actions.reorderHabits([ID2.toUpperCase()]);
    expect(op("rpc")).toEqual([
      "rpc",
      "reorder_habits",
      { p_habit_ids: [ID2] },
    ]);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "addStarterHabits rejects the prototype key %j",
    async (key) => {
      expect(await actions.addStarterHabits([key])).toMatchObject({
        code: "invalid",
        error: "Unknown habit template",
      });
      expect(calls).toEqual([]);
    },
  );

  it.each([null, undefined, { 0: "workout", length: 1 }, [1]])(
    "addStarterHabits rejects non-string-array input %j",
    async (keys) => {
      expect(await actions.addStarterHabits(keys)).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(calls).toEqual([]);
    },
  );

  it("addStarterHabits inserts exactly 3 rows in one call, with no server-owned fields", async () => {
    const res = await actions.addStarterHabits([
      "workout",
      "drink_water",
      "night_skincare",
    ]);
    expect(res).toEqual({ ok: true, data: { count: 3 } });
    const inserts = calls.filter((c) => c[0] === "insert");
    expect(inserts).toHaveLength(1);
    const rows = inserts[0]![1] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.template_key)).toEqual([
      "workout",
      "drink_water",
      "night_skincare",
    ]);
    for (const r of rows) {
      expect(r).not.toHaveProperty("user_id");
      expect(r).not.toHaveProperty("sort_order");
      expect(r).not.toHaveProperty("archived_at");
    }
  });

  it("addStarterHabits maps the cap, all or none, without revalidating", async () => {
    results = [
      {
        error: {
          code: "23514",
          message: "You can have at most 20 active habits",
        },
      },
    ];
    expect(await actions.addStarterHabits(["workout"])).toMatchObject({
      code: "at_cap",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deadlocks", () => {
  it("maps 40P01 to a retry message without leaking SQL", async () => {
    results = [{ error: { code: "40P01", message: "deadlock detected" } }];
    expect(await actions.archiveHabit(ID)).toEqual({
      ok: false,
      code: "failed",
      error: "Something else was saving at the same time. Try again.",
    });
  });
});
