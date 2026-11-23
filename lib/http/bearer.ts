import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** CRON_SECRET must be at least this long (`openssl rand -hex 32` is 64). */
export const MIN_SECRET_LENGTH = 32;

/**
 * True when `Authorization` is exactly `Bearer <secret>`. Compares SHA-256
 * digests in constant time, so neither a different length nor a near match
 * leaks through timing. A missing or too-short secret never matches.
 */
export function hasBearer(headers: Headers, secret: string | undefined) {
  // A short secret is a misconfiguration: refuse rather than accept it.
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const got = headers.get("authorization") ?? "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
