import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PAGE, RunError, runReminders } from "@/lib/push/run";
import type { AdminClient } from "@/lib/supabase/admin";

type Rpc = { data?: unknown; error?: { code: string } | null };

const sub = (id: string) => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: "p",
  auth: "a",
});
const reminder = (habit: string, subs = [sub(`s-${habit}`)]) => ({
  user_id: "u1",
  habit_id: habit,
  local_date: "2026-12-01",
  reminder_time: "08:00:00",
  title: `Habit ${habit}`,
  icon: null,
  category: "mind",
  points: 20,
  streak: 0,
  subscriptions: subs,
});

/** A fake admin client: queued RPC results, recorded table writes. */
function fakeAdmin(rpc: Record<string, Rpc[]>, writeError?: { code: string }) {
  const calls: {
    rpc: [string, unknown][];
    writes: [string, string, string[]][];
  } = {
    rpc: [],
    writes: [],
  };
  const admin = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args]);
      const r = rpc[name]?.shift() ?? { data: [] };
      return { data: r.data ?? null, error: r.error ?? null };
    }),
    from: vi.fn((table: string) => ({
      update: () => ({
        in: async (_c: string, ids: string[]) => {
          calls.writes.push([table, "update", ids]);
          return { error: writeError ?? null };
        },
      }),
      delete: () => ({
        in: async (_c: string, ids: string[]) => {
          calls.writes.push([table, "delete", ids]);
          return { error: writeError ?? null };
        },
      }),
    })),
  };
  return { admin: admin as unknown as AdminClient, calls };
}

const gone = Object.assign(new Error("gone"), { statusCode: 410 });

describe("runReminders", () => {
  it("sends reminders and savers to every device, records successes and drops gone devices", async () => {
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1", [sub("a"), sub("b")])] }],
      due_streak_savers: [
        {
          data: [
            {
              user_id: "u2",
              local_date: "2026-12-01",
              streak: 4,
              subscriptions: [sub("c")],
            },
          ],
        },
      ],
    });
    const send = vi.fn(async (s: { endpoint: string }, _payload: string) => {
      void _payload;
      if (s.endpoint.endsWith("/b")) throw gone;
    });
    const out = await runReminders({
      admin,
      send,
      now: new Date("2026-12-01T18:00:30Z"),
      random: () => 0,
    });
    expect(out).toEqual({ sent: 2, failed: 0, removed: 1 });
    expect(calls.rpc[0]).toEqual([
      "due_reminders",
      { p_now: "2026-12-01T18:00:30.000Z", p_limit: PAGE },
    ]);
    expect(calls.writes).toEqual([
      ["push_subscriptions", "update", ["a", "c"]],
      ["push_subscriptions", "delete", ["b"]],
    ]);
    const payloads = send.mock.calls.map((c) => JSON.parse(c[1]));
    expect(payloads.map((p) => p.tag)).toEqual([
      "habit-h1",
      "habit-h1",
      "streak-saver",
    ]);
  });

  it("pages due_reminders until a short page", async () => {
    const full = Array.from({ length: PAGE }, (_, i) => reminder(`h${i}`));
    const { admin, calls } = fakeAdmin({
      due_reminders: [{ data: full }, { data: [reminder("last")] }],
    });
    const out = await runReminders({ admin, send: vi.fn(async () => {}) });
    expect(calls.rpc.filter(([n]) => n === "due_reminders")).toHaveLength(2);
    expect(out.sent).toBe(PAGE + 1);
  });

  it("skips a malformed row and a user without devices, not the page", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [
        { data: [{ nonsense: true }, reminder("h1", []), reminder("h2")] },
      ],
    });
    const send = vi.fn(async () => {});
    expect(await runReminders({ admin, send })).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
  });

  it("fails on a due_reminders error, before sending anything", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ error: { code: "PGRST301" } }],
    });
    const send = vi.fn();
    await expect(runReminders({ admin, send })).rejects.toThrow(RunError);
    expect(send).not.toHaveBeenCalled();
  });

  it("still sends the collected reminders when the saver fails, then reports it", async () => {
    const { admin } = fakeAdmin({
      due_reminders: [{ data: [reminder("h1")] }],
      due_streak_savers: [{ error: { code: "57014" } }],
    });
    const send = vi.fn(async () => {});
    const err = await runReminders({ admin, send }).catch((e: RunError) => e);
    expect(send).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(RunError);
    expect((err as RunError).message).toBe(
      "reminders: due_streak_savers failed (57014)",
    );
    expect((err as RunError).result).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
  });

  it("never puts an endpoint or key in an error message", async () => {
    const { admin } = fakeAdmin(
      { due_reminders: [{ data: [reminder("h1")] }] },
      { code: "42501" },
    );
    const err = await runReminders({
      admin,
      send: vi.fn(async () => {}),
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "reminders: record successes failed (42501)",
    );
    expect((err as Error).message).not.toMatch(/googleapis|p256dh/);
  });
});
