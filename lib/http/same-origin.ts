/**
 * True when a state-changing request came from our own pages. Browsers send
 * `Origin` on every cross-origin POST, so a missing or different Origin from
 * another site is refused. `Sec-Fetch-Site` is the fallback when Origin is
 * absent (some same-origin form posts in older browsers).
 *
 * Assumes request.url carries the public origin (true on Vercel). Behind a
 * multi-zone rewrite or a proxy that drops x-forwarded-proto, add an allowlist.
 */
export function isSameOriginRequest(headers: Headers, requestUrl: string) {
  const expected = new URL(requestUrl).origin;
  const origin = headers.get("origin");
  if (origin) return origin === expected;
  const site = headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}
