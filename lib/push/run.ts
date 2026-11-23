import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { reminderMessage, streakSaverMessage } from "./copy";
import { sendAll, type Job, type SendFn } from "./send";

/** Rows per due_reminders call; it pages by itself (DECISIONS P6). */
export const PAGE = 500;
/** Pages per run, so one cron call stays well inside maxDuration. */
export const MAX_PAGES = 10;

const subscriptionSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});
const subscriptionsSchema = z.array(subscriptionSchema).nullable();

const reminderSchema = z.object({
  habit_id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  category: z.string(),
  points: z.number().int(),
  streak: z.number().int(),
  subscriptions: z.unknown(),
});
const saverSchema = z.object({
  streak: z.number().int(),
  subscriptions: z.unknown(),
});

export type RunResult = { sent: number; failed: number; removed: number };

export class RunError extends Error {
  /** What was sent before the failure, when anything was. */
  result?: RunResult;
  constructor(
    public readonly step: string,
    public readonly code?: string,
  ) {
    super(`reminders: ${step} failed${code ? ` (${code})` : ""}`);
  }
}

function jobsFor(subscriptions: unknown, message: Job["message"]): Job[] {
  const subs = subscriptionsSchema.safeParse(subscriptions);
  if (!subs.success || !subs.data) return [];
  return subs.data.map((subscription) => ({ subscription, message }));
}

/**
 * One cron tick: collect due reminders (paging until a short page) and
 * streak savers, send them, then record successes and drop subscriptions
 * the push service says are gone. Rows are logged by the database as they
 * are returned, so this never sends the same reminder twice.
 */
export async function runReminders(deps: {
  admin: AdminClient;
  send: SendFn;
  now?: Date;
  random?: () => number;
}): Promise<RunResult> {
  const { admin, send, random } = deps;
  const now = (deps.now ?? new Date()).toISOString();
  const jobs: Job[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin.rpc("due_reminders", {
      p_now: now,
      p_limit: PAGE,
    });
    if (error) throw new RunError("due_reminders", error.code);
    const rows: unknown[] = Array.isArray(data) ? data : [];
    for (const raw of rows) {
      // One malformed row is skipped, not the page: the rows are already
      // logged, so dropping a page would lose all of them.
      const r = reminderSchema.safeParse(raw);
      if (r.success) {
        jobs.push(
          ...jobsFor(r.data.subscriptions, reminderMessage(r.data, random)),
        );
      }
    }
    // A short page isn't an error: an overlapping run may be sending the rest.
    if (rows.length < PAGE) break;
  }

  // A saver failure mustn't cost the reminders already collected (and
  // logged): send those first, then report it.
  let saverError: RunError | undefined;
  const savers = await admin.rpc("due_streak_savers", { p_now: now });
  if (savers.error) {
    saverError = new RunError("due_streak_savers", savers.error.code);
  } else {
    for (const raw of Array.isArray(savers.data) ? savers.data : []) {
      const r = saverSchema.safeParse(raw);
      if (r.success) {
        jobs.push(
          ...jobsFor(
            r.data.subscriptions,
            streakSaverMessage(r.data.streak, random),
          ),
        );
      }
    }
  }

  const out = await sendAll(jobs, send);

  // A moved device gets a new id (DECISIONS P1), so an id can't credit or
  // remove the wrong owner.
  const sent = [...new Set(out.sent)];
  if (sent.length > 0) {
    const { error } = await admin
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString() })
      .in("id", sent);
    if (error) throw new RunError("record successes", error.code);
  }
  const removed = [...new Set(out.removed)];
  if (removed.length > 0) {
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .in("id", removed);
    if (error) throw new RunError("remove subscriptions", error.code);
  }
  const result = {
    sent: out.sent.length,
    failed: out.failed,
    removed: removed.length,
  };
  if (saverError) throw Object.assign(saverError, { result });
  return result;
}
