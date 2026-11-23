import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * True when `Authorization` is exactly `Bearer <secret>`. Compares SHA-256
 * digests in constant time, so neither a different length nor a near match
 * leaks through timing. An empty or missing secret never matches.
 */
export function hasBearer(headers: Headers, secret: string | undefined) {
  if (!secret) return false;
  const got = headers.get("authorization") ?? "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
