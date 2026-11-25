/**
 * Client-side copy of the SQL word filter (public.text_is_clean), for instant
 * feedback only. The server check is authoritative (plan §6.6).
 */
const BLOCKED =
  /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|nigg\w*|fag\w*|retard\w*|whore\w*|slut\w*)\b/i;

export function isClean(text: string): boolean {
  return !BLOCKED.test(text);
}

export const UNFRIENDLY_MESSAGE = "Please keep it friendly.";
