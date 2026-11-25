import type { Instrumentation } from "next";

/**
 * Server error monitoring (plan §12 Phase 8, DECISIONS H3): one structured
 * JSON line per uncaught server error, which Vercel's runtime logs index and
 * can alert on. Only the error name, digest, path and route are logged, never
 * messages, headers, cookies or bodies, so no session data or values reach
 * the logs.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  // The error's name, not its message: messages can carry values (a
  // Postgres key detail, a URL with a token). The digest links to the trace.
  const name = err instanceof Error ? err.name : typeof err;
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      source: "questrix",
      name,
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
