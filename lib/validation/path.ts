/** Dependency-free (no zod): imported by the proxy, which runs on every request. */

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
