import { z } from "zod";

/**
 * The push-service allowlist, the same as the database CHECK on
 * push_subscriptions.endpoint (DECISIONS P2): https, a known push service,
 * a path right after the host. With printable ASCII and at most 1024
 * characters, it's checked on the way in (here) and before every send.
 */
export const PUSH_ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.push\.apple\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com)\//;

export const pushEndpointSchema = z
  .string()
  .max(1024)
  .regex(/^[!-~]+$/)
  .regex(PUSH_ENDPOINT);

/** PushSubscription.toJSON(): the keys are base64url (P2 pins their sizes). */
export const subscribeSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
});

export const unsubscribeSchema = z.object({ endpoint: pushEndpointSchema });

export type SubscribeInput = z.infer<typeof subscribeSchema>;
