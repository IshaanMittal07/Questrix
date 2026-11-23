import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAX_PAGES, PAGE, RunError, runReminders } from "@/lib/push/run";
import type { AdminClient } from "@/lib/supabase/admin";

type Rpc = { data?: unknown; error?: { code: string } | null };

const sub = (id: string) => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: `p256dh-${id}`,
  auth: `auth-${id}`,
});
const reminder = (
  habit: string,
  subscriptions: unknown = [sub(`s-${habit}`)],
) => ({
  user_id: "u1",
  habit_id: habit,
  local_date: "2026-12-01",
  reminder_time: "08:00:00",
  title: `Habit ${habit}`,
  icon: null,
  category: "mind",
  points: 20,
  streak: 0,
  subscriptions,
});
const saver = (streak: number, subscriptions: unknown) => ({
  user_id: "u2",
  local_date: "2026-12-01",
  streak,
  subscriptions,
});

/** A fake admin client: queued RPC results (or one repeated), recorded writes. */
function fakeAdmin(rpc: Record<string, Rpc[] | (() => Rpc)>) {
  const calls: {
    rpc: [string, unknown][];
    writes: [string, string, string, string[]][];
  } = { rpc: [], writes: [] };
  const admin = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args]);
      const q = rpc[name];
      const r = (typeof q === "function" ? q() : q?.shift()) ?? { data: [] };
      return {
        data: "data" in r ? r.data : null,
        error: r.error ?? null,
      };
    }),
    from: vi.fn((table: string) => ({
      update: () => ({
        in: async (col: string, ids: string[]) => {
          calls.writes.push([table, "update", col, ids]);
          return { error: null };
        },
      }),
      delete: () => ({
        in: async (col: string, ids: string[]) => {
          calls.writes.push([table, "delete", col, ids]);
          return { error: null };
        },
      }),
    })),
  };
  return { admin: admin as unknown as AdminClient, calls };
}

const ok = vi.fn(async () => {});
const gone = Object.assign(new Error("gone"), { statusCode: 410 });

describe("runReminders paging", () => {
  it(`stops after ${MAX_PAGES} pages even when every page stays full`, async () => {
    let n = 0;
    const { admin, calls } = fakeAdmin({
      due_reminders: () => ({
        data: Array.from({ length: PAGE }, () => reminder(`h${n++}`)),
      }),
    });
    const send = vi.fn(async () => {});
    const out = await runReminders({ admin, send });
    expect(calls.rpc.filter(([name]) => name === "due_reminders")).toHaveLength(
      MAX_PAGES,
    );
    expect(send).toHaveBeenCalledTimes(MAX_PAGES * PAGE);
    expect(out.sent).toBe(MAX_PAGES * PAGE);
    // The saver still runs after the cap.
    expect(calls.rpc.at(-1)?.[0]).toBe("due_streak_savers");
  });

  it("passes the same p_now to every page and to the saver", async () => {
    const full = () =>
      Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`, []));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: full() }, { data: full() }, { data: [] }],
    });
    await runReminders({
      admin,
      send: ok,
      now: new Date("2026-03-29T01:00:00+01:00"),
    });
    const nows = calls.rpc.map(([, args]) => (args as { p_now: string }).p_now);
    expect(calls.rpc.map(([name]) => name)).toEqual([
      "due_reminders",
      "due_reminders",
      "due_reminders",
      "due_streak_savers",
    ]);
    expect(new Set(nows)).toEqual(new Set(["2026-03-29T00:00:00.000Z"]));
  });

  it("treats a full page of malformed rows as full and keeps paging", async () => {
    // The page size, not the number of valid rows, decides whether to page on.
    const junk = Array.from({ length: PAGE }, () => ({ nonsense: true }));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: junk }, { data: [reminder("h1")] }],
    });
    const out = await runReminders({ admin, send: ok });
    expect(calls.rpc.filter(([name]) => name === "due_reminders")).toHaveLength(
      2,
    );
    expect(out.sent).toBe(1);
  });
});

describe("runReminders with unexpected data shapes", () => {
  it.each([
    ["null", null],
    ["an object", { habit_id: "h1" }],
    ["a string", "[]"],
    ["a number", 5],
  ])(
    "treats due_reminders returning %s as an empty page",
    async (_label, data) => {
      const { admin, calls } = fakeAdmin({
        due_reminders: [{ data }],
        due_streak_savers: [{ data }],
      });
      const send = vi.fn();
      expect(await runReminders({ admin, send })).toEqual({
        sent: 0,
        failed: 0,
        removed: 0,
      });
      expect(send).not.toHaveBeenCalled();
      expect(calls.rpc.filter(([n]) => n === "due_reminders")).toHaveLength(1);
      expect(calls.writes).toEqual([]);
    },
  );

  it("skips a row whose subscriptions column is null (jsonb_agg of no rows)", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", null), reminder("h2")] }],
      due_streak_savers: [{ data: [saver(5, null)] }],
    });
    const send = vi.fn(async () => {});
    expect(await runReminders({ admin, send })).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
    expect(calls.writes).toEqual([
      ["push_subscriptions", "update", "id", ["s-h2"]],
    ]);
  });

  it.each([
    ["an object", { id: "x" }],
    ["a string", "s-1"],
    ["a list with a keyless subscription", [{ id: "x", endpoint: "e" }]],
    ["a list with a non-string id", [{ ...sub("x"), id: 7 }]],
  ])(
    "sends nothing for a row whose subscriptions are %s",
    async (_label, subscriptions) => {
      const { admin } = fakeAdmin({
        due_reminders: [{ data: [reminder("h1", subscriptions)] }],
      });
      const send = vi.fn();
      expect(await runReminders({ admin, send })).toEqual({
        sent: 0,
        failed: 0,
        removed: 0,
      });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("skips a malformed saver row but sends the valid ones", async () => {
    const { admin } = fakeAdmin({
      due_streak_savers: [
        {
          data: [
            { streak: "4", subscriptions: [sub("bad")] },
            { streak: 2.5, subscriptions: [sub("frac")] },
            saver(4, [sub("good")]),
          ],
        },
      ],
    });
    const send = vi.fn(async (_s: { endpoint: string }, _p: string) => {
      void _s;
      void _p;
    });
    expect(await runReminders({ admin, send })).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
    expect(send.mock.calls[0][0]).toMatchObject({
      endpoint: "https://fcm.googleapis.com/fcm/send/good",
    });
  });

  it("skips a reminder row with a fractional streak or points", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            { ...reminder("h1"), streak: 1.5 },
            { ...reminder("h2"), points: 2.5 },
            reminder("h3"),
          ],
        },
      ],
    });
    const send = vi.fn(async () => {});
    expect((await runReminders({ admin, send })).sent).toBe(1);
  });
});

describe("runReminders database writes", () => {
  it("de-duplicates subscription ids across rows when recording successes and removals", async () => {
    // One device gets two habits' reminders (and the saver): it is one row.
    const { admin, calls } = fakeAdmin({
      due_reminders: [
        {
          data: [
            reminder("h1", [sub("a"), sub("gone")]),
            reminder("h2", [sub("a"), sub("gone")]),
          ],
        },
      ],
      due_streak_savers: [{ data: [saver(3, [sub("a"), sub("gone")])] }],
    });
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/gone")) throw gone;
    });
    const out = await runReminders({ admin, send });
    expect(send).toHaveBeenCalledTimes(6);
    expect(calls.writes).toEqual([
      ["push_subscriptions", "update", "id", ["a"]],
      ["push_subscriptions", "delete", "id", ["gone"]],
    ]);
    // sent counts pushes delivered; removed counts distinct subscriptions.
    expect(out).toEqual({ sent: 3, failed: 0, removed: 1 });
  });

  it("writes nothing when nothing was sent or removed", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1")] }],
    });
    const send = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    expect(await runReminders({ admin, send })).toEqual({
      sent: 0,
      failed: 1,
      removed: 0,
    });
    expect(calls.writes).toEqual([]);
  });

  it("does not record a success for a subscription it is removing in the same run", async () => {
    // Two pushes to the same device: the first is delivered, the second is 410.
    let first = true;
    const { admin, calls } = fakeAdmin({
      due_reminders: [
        { data: [reminder("h1", [sub("x")]), reminder("h2", [sub("x")])] },
      ],
    });
    const send = vi.fn(async () => {
      if (first) {
        first = false;
        return;
      }
      throw gone;
    });
    await runReminders({ admin, send });
    // Both writes target the same id: harmless (the delete wins), pinned so a
    // change in ordering is a deliberate one.
    expect(calls.writes).toEqual([
      ["push_subscriptions", "update", "id", ["x"]],
      ["push_subscriptions", "delete", "id", ["x"]],
    ]);
  });

  it("reports a removal write error with its code and no endpoint", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", [sub("gone")])] }],
    });
    (admin as unknown as { from: unknown }).from = vi.fn(() => ({
      delete: () => ({
        in: async () => ({ error: { code: "42501" } }),
      }),
    }));
    const err = await runReminders({
      admin,
      send: vi.fn(async () => {
        throw gone;
      }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunError);
    expect((err as RunError).message).toBe(
      "reminders: remove subscriptions failed (42501)",
    );
  });

  it("sends the earlier pages when a later due_reminders page fails, then reports it", async () => {
    const full = Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`));
    const { admin } = fakeAdmin({
      due_reminders: [{ data: full }, { error: { code: "57014" } }],
    });
    const send = vi.fn(async () => {});
    const err = await runReminders({ admin, send }).catch((e: unknown) => e);
    expect((err as RunError).message).toBe(
      "reminders: due_reminders failed (57014)",
    );
    // Page 1's rows are already logged by the database: they are sent.
    expect(send).toHaveBeenCalledTimes(PAGE);
    expect((err as RunError).result).toEqual({
      sent: PAGE,
      failed: 0,
      removed: 0,
    });
  });
});

describe("runReminders payloads", () => {
  it("sends JSON with exactly {title, body, url, tag} and a /today url", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        {
          data: [
            { ...reminder("h1"), icon: "📚", category: "learning", streak: 5 },
            { ...reminder("h 2/?&"), category: "unknown" },
          ],
        },
      ],
      due_streak_savers: [{ data: [saver(9, [sub("s")])] }],
    });
    const send = vi.fn(async (_s: unknown, _p: string) => {
      void _s;
      void _p;
    });
    await runReminders({ admin, send, random: () => 0.5 });
    const payloads = send.mock.calls.map(([, p]) => JSON.parse(p) as unknown);
    expect(payloads).toHaveLength(3);
    for (const p of payloads) {
      expect(Object.keys(p as object).sort()).toEqual([
        "body",
        "tag",
        "title",
        "url",
      ]);
      for (const v of Object.values(p as object))
        expect(typeof v).toBe("string");
      expect((p as { url: string }).url).toMatch(/^\/today(\?|$)/);
    }
    expect(payloads[1]).toMatchObject({
      url: "/today?habit=h%202%2F%3F%26",
      tag: "habit-h 2/?&",
    });
    expect(payloads[2]).toMatchObject({ tag: "streak-saver", url: "/today" });
  });
});
