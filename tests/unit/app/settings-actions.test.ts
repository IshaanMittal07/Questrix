// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

let result: { error: unknown } = { error: null };
const update = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "u1" } } }),
    },
    from: () => ({
      update: (v: unknown) => {
        update(v);
        return { eq: async () => result };
      },
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateTimezone } = await import("@/app/(app)/settings/actions");

const form = (tz: string) => {
  const f = new FormData();
  f.set("timezone", tz);
  return f;
};

beforeEach(() => {
  result = { error: null };
  update.mockReset();
});

describe("updateTimezone", () => {
  it("saves a valid timezone", async () => {
    expect(await updateTimezone({}, form("Europe/London"))).toEqual({
      ok: true,
    });
    expect(update).toHaveBeenCalledWith({ timezone: "Europe/London" });
  });

  it("explains the once-a-week cooldown", async () => {
    result = {
      error: {
        code: "QX001",
        message: "You can change your timezone once every 7 days",
        hint: "Try again on or after 2026-11-24 08:30.",
      },
    };
    expect(await updateTimezone({}, form("Asia/Tokyo"))).toEqual({
      error:
        "You can change your timezone once every 7 days. Try again on or after 2026-11-24 08:30.",
    });
  });

  it("asks to retry after a deadlock", async () => {
    result = { error: { code: "40P01", message: "deadlock detected" } };
    expect(await updateTimezone({}, form("Asia/Tokyo"))).toEqual({
      error: "Something else was saving at the same time. Try again.",
    });
  });

  it("maps an unknown server timezone and other errors", async () => {
    result = { error: { code: "22023", message: "Unknown timezone" } };
    expect(await updateTimezone({}, form("Asia/Tokyo"))).toEqual({
      error: "Pick a valid timezone.",
    });
    result = { error: { code: "XX000", message: "boom" } };
    expect(await updateTimezone({}, form("Asia/Tokyo"))).toEqual({
      error: "Couldn't save. Try again.",
    });
  });
});
