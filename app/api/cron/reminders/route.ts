import { sendNotification } from "web-push";
import { hasBearer } from "@/lib/http/bearer";
import { RunError, runReminders } from "@/lib/push/run";
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
 * `{sent, failed, removed}`. Logs counts and error codes only, never
 * endpoints or keys (DECISIONS P1).
 */
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
    return Response.json(result);
  } catch (err) {
    const what =
      err instanceof RunError ? err.message : "reminders: run failed";
    const partial =
      err instanceof RunError && err.result
        ? ` ${JSON.stringify(err.result)}`
        : "";
    console.error(`${what}${partial}`);
    return Response.json({ error: "Reminders failed" }, { status: 500 });
  }
}
