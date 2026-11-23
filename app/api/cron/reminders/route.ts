import { sendNotification } from "web-push";
import { hasBearer } from "@/lib/http/bearer";
import { RunError, runReminders, type RunResult } from "@/lib/push/run";
import type { SendFn } from "@/lib/push/send";
import { readVapid } from "@/lib/push/vapid";
import { createAdminClient } from "@/lib/supabase/admin";

// POST only: pg_net POSTs, and the job writes (DECISIONS P8). No `dynamic`
// or `runtime` export: Cache Components removes them, and Node.js is the
// default runtime.
export const maxDuration = 60;

/**
 * The reminders cron (plan §7.2), called every minute by pg_cron through
 * pg_net with `Authorization: Bearer <CRON_SECRET>`. Returns
 * `{sent, failed, removed, skipped, malformed}`. Logs counts and error codes
 * only, never endpoints or keys (DECISIONS P1, P8).
 *
 * Every route under app/api/cron/ skips the session proxy, so each must
 * check hasBearer itself (a test enforces it).
 */
/** Pushes failed before the all-failed warning means more than a blip. */
const ALL_FAILED_MIN = 5;

/** Every push failing is likely a configuration problem (a revoked key). */
function warnIfAllFailed(result: RunResult) {
  if (result.sent === 0 && result.failed >= ALL_FAILED_MIN) {
    console.error(
      `reminders: all ${result.failed} pushes failed; check the VAPID keys`,
    );
  }
}

export async function POST(request: Request) {
  if (!hasBearer(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const vapid = readVapid();
  if (!vapid) {
    console.error("reminders: VAPID keys are missing or invalid");
    return Response.json({ error: "Push is not configured" }, { status: 500 });
  }
  const send: SendFn = (subscription, payload) =>
    sendNotification(subscription, payload, {
      vapidDetails: vapid,
      TTL: 3600,
      urgency: "high",
      // A push service that never answers mustn't hold a slot until
      // maxDuration.
      timeout: 10_000,
    });
  try {
    const result = await runReminders({ admin: createAdminClient(), send });
    console.info(`reminders: ${JSON.stringify(result)}`);
    warnIfAllFailed(result);
    return Response.json(result);
  } catch (err) {
    if (err instanceof RunError) {
      console.error(`${err.message} ${JSON.stringify(err.result)}`);
      warnIfAllFailed(err.result);
    } else {
      console.error("reminders: run failed");
    }
    return Response.json({ error: "Reminders failed" }, { status: 500 });
  }
}
