// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeatmap, heatLevel, localDate } from "@/lib/profile/heatmap";
import { assetCss, assetText } from "@/lib/shop/types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
let signedIn = true;
vi.mock("@/lib/supabase/session", () => ({
  getVerifiedUser: async () =>
    signedIn ? { userId: "u1", supabase: { rpc } } : null,
}));

const ID = "11111111-1111-4111-8111-111111111111";

describe("assetCss / assetText", () => {
  it("allows only our name classes", () => {
    expect(assetCss({ css: "name-color-cyan" })).toBe("name-color-cyan");
    expect(assetCss({ css: "name-style-glitch" })).toBe("name-style-glitch");
    expect(assetCss({ css: "bg-red-500" })).toBeNull();
    expect(assetCss({ css: "name-color-cyan evil" })).toBeNull();
    expect(assetCss(null)).toBeNull();
  });
  it("reads title text, capped", () => {
    expect(assetText({ text: "Rookie" })).toBe("Rookie");
    expect(assetText({ text: "x".repeat(80) })).toHaveLength(40);
    expect(assetText({ text: 3 })).toBeNull();
  });
});

describe("heatmap", () => {
  it("formats the local date in the given zone", () => {
    const t = new Date("2026-11-25T02:00:00Z");
    expect(localDate(t, "UTC")).toBe("2026-11-25");
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-11-24");
  });
  it("builds 12 Sunday-first weeks ending in today's week", () => {
    // 2026-11-25 is a Wednesday.
    const weeks = buildHeatmap("2026-11-25", new Map([["2026-11-24", 3]]));
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const last = weeks[11];
    expect(last[0].date).toBe("2026-11-22");
    expect(last[3]).toMatchObject({ date: "2026-11-25", future: false });
    expect(last[4].future).toBe(true);
    expect(last[2].count).toBe(3);
    expect(weeks[0][0].date).toBe("2026-09-06");
  });
  it("buckets counts", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("purchaseItem", () => {
  beforeEach(() => {
    rpc.mockReset();
    signedIn = true;
  });

  it("rejects a bad id without calling the server", async () => {
    const { purchaseItem } = await import("@/lib/shop/actions");
    expect(await purchaseItem("nope")).toEqual({
      ok: false,
      error: "That item isn't available.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the new balance", async () => {
    rpc.mockResolvedValue({
      data: { new_balance: 800, streak_freezes: 1 },
      error: null,
    });
    const { purchaseItem } = await import("@/lib/shop/actions");
    expect(await purchaseItem(ID)).toEqual({
      ok: true,
      balance: 800,
      streakFreezes: 1,
    });
    expect(rpc).toHaveBeenCalledWith("purchase_item", { p_item_id: ID });
  });

  it.each([
    ["QX201", "You don't have enough points for that yet."],
    ["QX202", "You already own that."],
    ["QX203", "Reach the required level to unlock that."],
    ["QX204", "You're already holding the most streak freezes."],
    ["XX000", "Couldn't buy that. Try again."],
  ])("maps %s by code", async (code, error) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "ignored" } });
    const { purchaseItem } = await import("@/lib/shop/actions");
    expect(await purchaseItem(ID)).toEqual({ ok: false, error });
  });

  it("is signed out without a session", async () => {
    signedIn = false;
    const { purchaseItem } = await import("@/lib/shop/actions");
    expect(await purchaseItem(ID)).toEqual({
      ok: false,
      error: "You're signed out.",
    });
  });
});

describe("equipItem", () => {
  beforeEach(() => {
    rpc.mockReset();
    signedIn = true;
  });

  it("validates the slot", async () => {
    const { equipItem } = await import("@/lib/shop/actions");
    expect((await equipItem("consumable", ID)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes null to unequip", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { equipItem } = await import("@/lib/shop/actions");
    expect(await equipItem("title", null)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("equip_item", {
      p_slot: "title",
      p_item_id: null,
    });
  });

  it("maps not owned", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { equipItem } = await import("@/lib/shop/actions");
    expect(await equipItem("outfit", ID)).toEqual({
      ok: false,
      error: "You don't own that.",
    });
  });
});
