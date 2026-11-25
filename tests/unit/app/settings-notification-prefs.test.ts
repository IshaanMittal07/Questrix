// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every builder call on the fake client, in order. */
const calls: Array<[string, ...unknown[]]> = [];
let result: { error: unknown } = { error: null };
let claims: { claims?: { sub?: string } } | null = { claims: { sub: "u1" } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: claims }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return {
        update: (v: unknown) => {
          calls.push(["update", v]);
          return {
            eq: async (col: string, val: unknown) => {
              calls.push(["eq", col, val]);
              return result;
            },
          };
        },
      };
    },
  }),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { setNotificationPrefs } = await import("@/app/(app)/settings/actions");

const GENERIC = { ok: false, error: "Couldn't save. Try again." };

beforeEach(() => {
  calls.length = 0;
  result = { error: null };
  claims = { claims: { sub: "u1" } };
  revalidatePath.mockReset();
});

describe("setNotificationPrefs", () => {
  it.each([
    ["an empty object", {}],
    ["an unknown key", { push_enabled: true, points_balance: 9999 }],
    ["only an unknown key", { timezone: "UTC" }],
    ["a string boolean", { push_enabled: "true" }],
    ["a number", { streak_saver_enabled: 1 }],
    ["null", { push_enabled: null }],
    ["a non-object", "push_enabled"],
    ["undefined", undefined],
  ])("rejects %s without touching the database", async (_, input) => {
    expect(await setNotificationPrefs(input)).toEqual(GENERIC);
    expect(calls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["no claims", null],
    ["claims without a sub", { claims: {} }],
    ["an empty sub", { claims: { sub: "" } }],
  ])("is signed out with %s", async (_, c) => {
    claims = c;
    expect(await setNotificationPrefs({ push_enabled: false })).toEqual({
      ok: false,
      error: "You're signed out.",
    });
    expect(calls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates only the given column, on the caller's own row", async () => {
    expect(await setNotificationPrefs({ push_enabled: false })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      ["from", "profiles"],
      ["update", { push_enabled: false }],
      ["eq", "id", "u1"],
    ]);
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it("updates the streak saver alone, or both together", async () => {
    await setNotificationPrefs({ streak_saver_enabled: true });
    expect(calls[1]).toEqual(["update", { streak_saver_enabled: true }]);
    calls.length = 0;
    await setNotificationPrefs({
      push_enabled: true,
      streak_saver_enabled: false,
    });
    expect(calls[1]).toEqual([
      "update",
      { push_enabled: true, streak_saver_enabled: false },
    ]);
  });

  it("asks to retry after a deadlock, without revalidating", async () => {
    result = { error: { code: "40P01", message: "deadlock detected" } };
    expect(await setNotificationPrefs({ push_enabled: true })).toEqual({
      ok: false,
      error: "Something else was saving at the same time. Try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["a permission error", { code: "42501", message: "permission denied" }],
    ["a QX001 server message", { code: "QX001", message: "Too many" }],
    ["an error without a code", { message: "boom" }],
  ])("maps %s to a generic message, never raw SQL", async (_, error) => {
    result = { error };
    expect(await setNotificationPrefs({ push_enabled: true })).toEqual(GENERIC);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
