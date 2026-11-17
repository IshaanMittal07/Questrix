// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake supabase-js client: every builder call is recorded, and awaiting the
 * chain (or .maybeSingle()) resolves to the next queued result.
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
        if (prop === "maybeSingle" || prop === "single") {
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

vi.mock("server-only", () => ({}));
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
  }),
}));

const q = await import("@/lib/habits/queries");

const ID = "3f1c2a4e-8b7d-4c6e-9a1f-2b3c4d5e6f70";
const row = { id: ID, title: "Read" };

const selected = () => calls.find((c) => c[0] === "select")?.[1] as string;

beforeEach(() => {
  calls.length = 0;
  results = [];
  userId = "u1";
});

describe("listActiveHabits", () => {
  it("lists the user's unarchived habits in list order", async () => {
    results = [{ data: [row] }];
    expect(await q.listActiveHabits()).toEqual([row]);
    expect(calls).toEqual([
      ["from", "habits"],
      ["select", expect.any(String)],
      ["eq", "user_id", "u1"],
      ["is", "archived_at", null],
      ["order", "sort_order"],
      ["order", "created_at"],
      ["order", "id"],
    ]);
  });

  it("never selects user_id", async () => {
    results = [{ data: [] }];
    await q.listActiveHabits();
    const cols = selected()
      .split(",")
      .map((c) => c.trim());
    expect(cols).not.toContain("user_id");
    expect(cols).not.toContain("*");
    expect(cols).toContain("archived_at");
  });

  it("returns [] when signed out, without querying", async () => {
    userId = null;
    expect(await q.listActiveHabits()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("throws on a database error", async () => {
    results = [{ error: { code: "XX000", message: "boom" } }];
    await expect(q.listActiveHabits()).rejects.toThrow(
      "Couldn't load habits: boom",
    );
  });
});

describe("listArchivedHabits", () => {
  it("lists archived habits newest first, capped", async () => {
    results = [{ data: [row] }];
    expect(await q.listArchivedHabits()).toEqual([row]);
    expect(calls).toEqual([
      ["from", "habits"],
      ["select", expect.any(String)],
      ["eq", "user_id", "u1"],
      ["not", "archived_at", "is", null],
      ["order", "archived_at", { ascending: false }],
      ["order", "id"],
      ["limit", q.ARCHIVED_LIST_MAX],
    ]);
    expect(q.ARCHIVED_LIST_MAX).toBe(200);
  });

  it("returns [] when signed out, without querying", async () => {
    userId = null;
    expect(await q.listArchivedHabits()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("throws on a database error", async () => {
    results = [{ error: { message: "nope" } }];
    await expect(q.listArchivedHabits()).rejects.toThrow(
      "Couldn't load habits: nope",
    );
  });
});

describe("getMyHabit", () => {
  it("looks up one of the user's habits by the lowercased id", async () => {
    results = [{ data: row }];
    expect(await q.getMyHabit(ID.toUpperCase())).toEqual(row);
    expect(calls).toEqual([
      ["from", "habits"],
      ["select", expect.any(String)],
      ["eq", "user_id", "u1"],
      ["eq", "id", ID],
      ["maybeSingle"],
    ]);
  });

  it("returns null when no row is visible", async () => {
    results = [{ data: null }];
    expect(await q.getMyHabit(ID)).toBeNull();
  });

  it.each(["nope", "", `${ID}x`, "1; drop table habits", "../" + ID])(
    "returns null for malformed id %j without a database call",
    async (id) => {
      expect(await q.getMyHabit(id)).toBeNull();
      expect(calls).toEqual([]);
    },
  );

  it("returns null when signed out, without querying", async () => {
    userId = null;
    expect(await q.getMyHabit(ID)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("throws on a database error", async () => {
    results = [{ error: { message: "boom" } }];
    await expect(q.getMyHabit(ID)).rejects.toThrow(
      "Couldn't load the habit: boom",
    );
  });
});
