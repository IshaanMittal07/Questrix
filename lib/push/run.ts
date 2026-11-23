import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { reminderMessage, streakSaverMessage } from "./copy";
import { sendAll, type Job, type SendFn } from "./send";

/** Rows per due_reminders call; it pages by itself (DECISIONS P6). */
export const PAGE = 100;
/** Pages per run, at most; the fetch budget is the real limit. */
export const MAX_PAGES = 30;
/**
 * Fetch no new page (and skip the saver) after this long. A fetched row is
 * already logged, so only rows never fetched survive to the next minute's
 * overlapping window: stop fetching early, not sending (review of PR #97).
 */
export const FETCH_BUDGET_MS = 25_000;
/**
 * Start no new push after this long. With a 10 s socket timeout per push
 * and maxDuration 60 s, that leaves time for the last page's writes.
 */
export const SEND_BUDGET_MS = 40_000;
/** Ids per write: `.in()` puts them in the URL, which gateways cap. */
export const WRITE_CHUNK = 100;

/** The database's endpoint allowlist, re-checked before any request (P2). */
export const ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.push\.apple\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com)\//;

const subscriptionSchema = z.object({
  id: z.string(),
  // As the database's CHECK: printable ASCII, at most 1024, allowlisted.
  endpoint: z
    .string()
    .max(1024)
    .regex(/^[!-~]+$/)
    .regex(ENDPOINT),
  p256dh: z.string(),
  auth: z.string(),
});
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

export type RunResult = {
  /** Pushes delivered. */
  sent: number;
  /** Pushes that failed (not retried: at most once, P6). */
  failed: number;
  /** Subscriptions deleted after a 404/410. */
  removed: number;
  /** Pushes not started because the send budget ran out (lost: P6). */
  skipped: number;
  /** Rows or devices dropped as malformed (already logged, so lost). */
  malformed: number;
  /** The run stopped with reminders possibly still due (budget or cap). */
  truncated: boolean;
};

export class RunError extends Error {
  constructor(
    /** Every step that failed, in order. */
    public readonly steps: string[],
    /** What was done despite the failures. */
    public readonly result: RunResult,
  ) {
    super(`reminders: ${steps.join(", ")} failed`);
  }
}

type Clock = () => number;

/**
 * One cron tick, page by page: fetch due reminders, send them, record the
 * results, and fetch the next page only while time allows; then the streak
 * savers the same way. Rows are logged by the database as they're fetched,
 * so nothing fetched is dropped, and a failed step doesn't stop the others:
 * all of them are reported at the end, with the counts.
 */
export async function runReminders(deps: {
  admin: AdminClient;
  send: SendFn;
  now?: Date;
  random?: () => number;
  clock?: Clock;
}): Promise<RunResult> {
  const { admin, send, random } = deps;
  const clock = deps.clock ?? Date.now;
  const start = clock();
  const now = (deps.now ?? new Date(start)).toISOString();
  const result: RunResult = {
    sent: 0,
    failed: 0,
    removed: 0,
    skipped: 0,
    malformed: 0,
    truncated: false,
  };
  const failures: string[] = [];

  function jobsFor(subscriptions: unknown, message: Job["message"]): Job[] {
    if (!Array.isArray(subscriptions)) {
      if (subscriptions != null) result.malformed += 1;
      return [];
    }
    const jobs: Job[] = [];
    for (const raw of subscriptions) {
      const s = subscriptionSchema.safeParse(raw);
      if (s.success) jobs.push({ subscription: s.data, message });
      else result.malformed += 1;
    }
    return jobs;
  }

  async function deliver(jobs: Job[]) {
    const out = await sendAll(
      jobs,
      send,
      undefined,
      start + SEND_BUDGET_MS,
      clock,
    );
    result.sent += out.sent.length;
    result.failed += out.failed;
    result.skipped += out.skipped;
    // A moved device gets a new id (P1): an id can't touch the wrong owner.
    const sent = [...new Set(out.sent)];
    for (let i = 0; i < sent.length; i += WRITE_CHUNK) {
      const { error } = await admin
        .from("push_subscriptions")
        .update({ last_success_at: new Date(clock()).toISOString() })
        .in("id", sent.slice(i, i + WRITE_CHUNK));
      if (error) failures.push(`record successes (${error.code})`);
    }
    const removed = [...new Set(out.removed)];
    for (let i = 0; i < removed.length; i += WRITE_CHUNK) {
      const { data, error } = await admin
        .from("push_subscriptions")
        .delete()
        .in("id", removed.slice(i, i + WRITE_CHUNK))
        .select("id");
      if (error) failures.push(`remove subscriptions (${error.code})`);
      // Rows actually deleted: an overlapping run may have got there first.
      else result.removed += Array.isArray(data) ? data.length : 0;
    }
  }

  // Savers first: at most one row per user, and a 20:00 saver is due in only
  // two overlapping runs, so it mustn't be what a busy minute cuts
  // (reviews of PR #97).
  const savers = await admin.rpc("due_streak_savers", { p_now: now });
  if (savers.error) {
    failures.push(`due_streak_savers (${savers.error.code})`);
  } else {
    const jobs: Job[] = [];
    for (const raw of Array.isArray(savers.data) ? savers.data : []) {
      const r = saverSchema.safeParse(raw);
      if (r.success) {
        jobs.push(
          ...jobsFor(
            r.data.subscriptions,
            streakSaverMessage(r.data.streak, random),
          ),
        );
      } else {
        result.malformed += 1;
      }
    }
    await deliver(jobs);
  }

  let more = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    // Page 0 too: a fetched row is logged, so fetching what can't be sent
    // in time would lose it; left unfetched, the next minute's window has it.
    if (clock() - start >= FETCH_BUDGET_MS) break;
    const { data, error } = await admin.rpc("due_reminders", {
      p_now: now,
      p_limit: PAGE,
    });
    if (error) {
      failures.push(`due_reminders (${error.code})`);
      more = false;
      break;
    }
    const rows: unknown[] = Array.isArray(data) ? data : [];
    const jobs: Job[] = [];
    for (const raw of rows) {
      // One malformed row is skipped, not the page.
      const r = reminderSchema.safeParse(raw);
      if (r.success) {
        jobs.push(
          ...jobsFor(r.data.subscriptions, reminderMessage(r.data, random)),
        );
      } else {
        result.malformed += 1;
      }
    }
    await deliver(jobs);
    // A short page isn't an error: an overlapping run may be sending the rest.
    if (rows.length < PAGE) {
      more = false;
      break;
    }
  }
  // Stopped by the budget or the page cap with a full last page: reminders
  // may still be due. Logged, so a saturated minute is visible.
  result.truncated = more;

  // One entry per failed step: a large run fails many chunks the same way.
  if (failures.length > 0) throw new RunError([...new Set(failures)], result);
  return result;
}
