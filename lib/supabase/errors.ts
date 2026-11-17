/**
 * Helpers for turning database errors into user-facing text. Only messages
 * our own SQL raises for users (QX001: rate limits and cooldowns) are ever
 * shown; everything else is mapped by code.
 */

/** SQLSTATE for a deadlock. Engine writes can hit one; retrying is safe. */
export const DEADLOCK = "40P01";

export const RETRY_MESSAGE =
  "Something else was saving at the same time. Try again.";

/** "Message." plus the hint, with exactly one period after the message. */
export function serverMessage(message: string, hint?: string | null) {
  const sentence = message.replace(/(?<![.!?])$/, ".");
  return hint ? `${sentence} ${hint}` : sentence;
}
