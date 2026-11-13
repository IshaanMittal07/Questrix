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

/** Same-origin relative path only (blocks open redirects like //evil.com). */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/today",
) {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return fallback;
  }
  return next;
}
