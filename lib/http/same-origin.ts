/**
 * True when a state-changing request came from our own pages. Browsers send
 * `Origin` on every cross-origin POST, so a missing or different Origin from
 * another site is refused. `Sec-Fetch-Site` is the fallback when Origin is
 * absent (some same-origin form posts in older browsers).
 */
export function isSameOriginRequest(headers: Headers, requestUrl: string) {
  const expected = new URL(requestUrl).origin;
  const origin = headers.get("origin");
  if (origin) return origin === expected;
  const site = headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}
