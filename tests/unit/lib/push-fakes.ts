import { vi } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";

/** Shared fakes for the reminders sender tests (not a test file itself). */

export type Rpc = {
  data?: unknown;
  error?: { code: string; message?: string } | null;
};
export type Write = {
  table: string;
  op: "update" | "delete";
  column: string;
  ids: string[];
  /** Columns asked back from a delete (`.select(...)`). */
  select?: string;
};

export const sub = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: `p256dh-${id}`,
  auth: `auth-${id}`,
  ...over,
});

export const reminder = (
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

export const saver = (streak: number, subscriptions: unknown) => ({
  user_id: "u2",
  local_date: "2026-12-01",
  streak,
  subscriptions,
});

export const gone = Object.assign(new Error("gone"), { statusCode: 410 });

export type FakeOptions = {
  /** Called on every rpc, e.g. to advance a fake clock. */
  onRpc?: (name: string) => void;
  /** Sees the values of every update. */
  onUpdate?: (values: unknown) => void;
  /** An error for the n-th update call (0-based), or none. */
  updateError?: (n: number, ids: string[]) => { code: string } | null;
  /** An error for the n-th delete call (0-based), or none. */
  deleteError?: (n: number, ids: string[]) => { code: string } | null;
  /** Ids the delete reports as deleted (default: all of them). */
  deleted?: (ids: string[]) => string[];
};

/**
 * A fake service-role client: queued (or generated) RPC results, recorded
 * table writes in call order.
 */
export function fakeAdmin(
  rpc: Record<string, Rpc[] | (() => Rpc)>,
  opts: FakeOptions = {},
) {
  const calls: {
    rpc: [string, unknown][];
    writes: Write[];
    /** Every rpc and write, in order ("rpc due_reminders", "update", ...). */
    log: string[];
  } = { rpc: [], writes: [], log: [] };
  let updates = 0;
  let deletes = 0;
  const admin = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args]);
      calls.log.push(`rpc ${name}`);
      opts.onRpc?.(name);
      const q = rpc[name];
      const r = (typeof q === "function" ? q() : q?.shift()) ?? { data: [] };
      return { data: "data" in r ? r.data : null, error: r.error ?? null };
    }),
    from: vi.fn((table: string) => ({
      update: (values: unknown) => ({
        in: async (column: string, ids: string[]) => {
          calls.writes.push({ table, op: "update", column, ids });
          calls.log.push("update");
          opts.onUpdate?.(values);
          return { error: opts.updateError?.(updates++, ids) ?? null };
        },
      }),
      delete: () => ({
        in: (column: string, ids: string[]) => ({
          select: async (select: string) => {
            calls.writes.push({ table, op: "delete", column, ids, select });
            calls.log.push("delete");
            const error = opts.deleteError?.(deletes++, ids) ?? null;
            if (error) return { data: null, error };
            const kept = opts.deleted ? opts.deleted(ids) : ids;
            return { data: kept.map((id) => ({ id })), error: null };
          },
        }),
      }),
    })),
  };
  return { admin: admin as unknown as AdminClient, calls };
}

/** A clock the test moves by hand. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    get elapsed() {
      return t - start;
    },
  };
}

export const ZERO = {
  sent: 0,
  failed: 0,
  removed: 0,
  skipped: 0,
  malformed: 0,
};
