import { z } from "zod";

/** Mirrors the DB check: ^[a-z0-9_]{3,20}$ (input is lower-cased first). */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(20, "At most 20 characters")
  .regex(/^[a-z0-9_]+$/, "Only letters, numbers and _");

export const emailSchema = z.string().trim().email("Enter a valid email");

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, "Unknown timezone");

// Control characters (browsers strip tab/CR/LF, so "/\t/evil.com" becomes
// "//evil.com") and backslashes (treated as "/").
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]/;
const PATH_BASE = "http://questrix.invalid";

/** Same-origin relative path only (blocks open redirects like //evil.com). */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/today",
) {
  if (!next || !next.startsWith("/") || UNSAFE_PATH_CHARS.test(next)) {
    return fallback;
  }
  try {
    // Resolve the way a browser would and require it to stay on our origin.
    const url = new URL(next, PATH_BASE);
    const out = `${url.pathname}${url.search}${url.hash}`;
    // Check the *output* too: dot-segment removal can turn "/..//evil.com"
    // (same-origin as input) into the protocol-relative "//evil.com".
    if (
      url.origin !== PATH_BASE ||
      !out.startsWith("/") ||
      out.startsWith("//")
    ) {
      return fallback;
    }
    return out;
  } catch {
    return fallback;
  }
}

/** The device's IANA timezone in canonical form, or UTC if it's unusable. */
export function deviceTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimezone(tz) && !tz.startsWith("Etc/Unknown")) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
      }).resolvedOptions().timeZone;
    }
  } catch {
    // fall through
  }
  return "UTC";
}
