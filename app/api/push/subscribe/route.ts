import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { subscribeSchema, unsubscribeSchema } from "@/lib/validation/push";

/** Bodies are small JSON; anything bigger is refused before parsing. */
const MAX_BODY = 4096;

async function readJson(request: Request): Promise<unknown> {
  // Refuse early when the size is declared, then check the bytes read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    throw new Error("too large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY) throw new Error("too large");
  return JSON.parse(new TextDecoder().decode(bytes));
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
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
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
      return Response.json(
        { error: "Too many devices have notifications on" },
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
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
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
