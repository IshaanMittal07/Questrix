import "server-only";

import type { PushMessage } from "./copy";

export type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type Job = { subscription: Subscription; message: PushMessage };

export type SendFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;

export type SendOutcome = {
  sent: string[];
  failed: number;
  removed: string[];
  /** Jobs never started because the deadline passed. */
  skipped: number;
};

/** At most this many pushes in flight (plan §7.2). */
export const CONCURRENCY = 20;

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const s = (err as { statusCode: unknown }).statusCode;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}

/**
 * Send every job with at most CONCURRENCY in flight. A 404 or 410 means the
 * device unsubscribed: its subscription id goes to `removed`. Any other
 * error counts as failed (at most once: it isn't retried, DECISIONS P6).
 * Errors are never logged here: web-push errors carry the endpoint.
 */
export async function sendAll(
  jobs: Job[],
  send: SendFn,
  concurrency = CONCURRENCY,
  deadline = Number.POSITIVE_INFINITY,
  clock: () => number = Date.now,
): Promise<SendOutcome> {
  const out: SendOutcome = { sent: [], failed: 0, removed: [], skipped: 0 };
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      if (clock() >= deadline) return;
      const { subscription: s, message } = jobs[next++];
      try {
        await send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(message),
        );
        out.sent.push(s.id);
      } catch (err) {
        const status = statusOf(err);
        if (status === 404 || status === 410) out.removed.push(s.id);
        else out.failed += 1;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
  out.skipped = jobs.length - next;
  return out;
}
