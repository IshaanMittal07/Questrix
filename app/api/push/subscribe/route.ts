import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { subscribeSchema, unsubscribeSchema } from "@/lib/validation/push";

/** save_push_subscription's hint for the 10-device cap (migration 20261123000200). */
const DEVICE_CAP_HINT = "Turn notifications off on a device you no longer use.";

/** Bodies are small JSON; anything bigger is refused before parsing. */
const MAX_BODY = 4096;

class BadBody extends Error {
  constructor(readonly status: 400 | 415) {
    super("bad body");
  }
}

/**
 * JSON only (415 otherwise), at most MAX_BODY bytes: refused early when the
 * size is declared, and read as a stream that stops once it passes the
 * limit, so a chunked body is never buffered whole.
 */
async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new BadBody(415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new BadBody(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new BadBody(400);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BadBody(400);
  }
}

function badBody(err: unknown) {
  const status = err instanceof BadBody ? err.status : 400;
  return Response.json(
    { error: status === 415 ? "Send JSON" : "Invalid request" },
    { status },
  );
}

/** Same-origin and signed in, or the error response. */
async function guard(request: Request) {
  if (!isSameOriginRequest(request.headers, request.url)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    return {
      error: Response.json({ error: "Sign in first" }, { status: 401 }),
    };
  }
  return { supabase };
}

/**
 * Save this device's push subscription for the signed-in user (plan §7.1).
 * The RPC moves an endpoint saved by someone else to the caller (P1) and
 * caps devices per user (QX001 → 429). Never logs the endpoint or keys.
 */
export async function POST(request: Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return badBody(err);
  }
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const { endpoint, keys } = parsed.data;
  const { error } = await g.supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    // Cut by code point (the database caps it at 512 too).
    p_user_agent:
      Array.from(request.headers.get("user-agent") ?? "")
        .slice(0, 512)
        .join("") || undefined,
  });
  if (error) {
    if (error.code === "QX001") {
      // QX001 covers several limits (P5): the device cap is told apart by
      // its exact hint, so another limit can never read as it.
      const devices = error.hint === DEVICE_CAP_HINT;
      return Response.json(
        devices
          ? {
              error: "Too many devices have notifications on",
              limit: "devices",
            }
          : { error: "Too many tries; try again later", limit: "rate" },
        { status: 429 },
      );
    }
    console.error(`push subscribe failed (${error.code})`);
    return Response.json({ error: "Couldn't save" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

/**
 * Forget this device's subscription (unsubscribing, or signing out while the
 * session is still valid, P1). Owner-only by RLS: someone else's endpoint
 * simply matches nothing.
 */
export async function DELETE(request: Request) {
  const g = await guard(request);
  if (g.error) return g.error;
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    return badBody(err);
  }
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const { error } = await g.supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint);
  if (error) {
    console.error(`push unsubscribe failed (${error.code})`);
    return Response.json({ error: "Couldn't remove" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
