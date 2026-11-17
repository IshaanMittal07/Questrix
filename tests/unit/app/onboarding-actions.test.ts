// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** redirect() never returns in Next: model that by throwing. */
class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

type Result = { data?: unknown; error?: unknown };
let profile: Result;
let updates: Result[];
let rpcs: Record<string, Result>;
const updateCalls: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) },
    rpc: async (name: string) => ({
      data: rpcs[name]?.data ?? null,
      error: rpcs[name]?.error ?? null,
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: profile.data ?? null,
            error: profile.error ?? null,
          }),
        }),
      }),
      update: (values: unknown) => {
        updateCalls.push(values);
        return {
          eq: async () => {
            const r = updates.shift() ?? {};
            return { data: null, error: r.error ?? null };
          },
        };
      },
    }),
  }),
}));

const { completeOnboarding } = await import("@/app/onboarding/actions");

function form() {
  const f = new FormData();
  f.set("username", "Quester_1");
  f.set("timezone", "Europe/London");
  f.set("avatarBaseId", "3f1c2a7e-8b4d-4c6e-9a1f-2d3e4f5a6b7c");
  return f;
}

async function run() {
  try {
    return { state: await completeOnboarding({}, form()) };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.to };
    throw e;
  }
}

beforeEach(() => {
  profile = { data: { onboarded_at: null } };
  updates = [];
  rpcs = { username_available: { data: true }, equip_item: {} };
  updateCalls.length = 0;
});

describe("completeOnboarding", () => {
  it("sends the user on to step 2 (starter habits) on success", async () => {
    expect(await run()).toEqual({ redirect: "/onboarding/habits" });
    expect(updateCalls).toEqual([
      { username: "quester_1", timezone: "Europe/London" },
    ]);
  });

  it("still reaches step 2 after the UTC timezone fallback", async () => {
    updates = [{ error: { code: "22023" } }, {}];
    expect(await run()).toEqual({ redirect: "/onboarding/habits" });
    expect(updateCalls[1]).toEqual({ username: "quester_1", timezone: "UTC" });
  });

  it("sends an already-onboarded user to Today, not back to step 2", async () => {
    profile = { data: { onboarded_at: "2026-11-01T00:00:00Z" } };
    expect(await run()).toEqual({ redirect: "/today" });
    expect(updateCalls).toEqual([]);
  });

  it("stays on step 1 when the username was just taken", async () => {
    updates = [{ error: { code: "23505" } }];
    expect(await run()).toEqual({
      state: {
        error: "That username was just taken — try another.",
        field: "username",
      },
    });
  });

  it("stays on step 1 when equipping the avatar fails", async () => {
    rpcs.equip_item = { error: { message: "nope" } };
    expect(await run()).toEqual({
      state: { error: "Couldn't save your avatar.", field: "form" },
    });
    expect(updateCalls).toEqual([]);
  });
});
