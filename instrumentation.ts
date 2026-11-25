import type { Instrumentation } from "next";

/**
 * Server error monitoring (plan §12 Phase 8, DECISIONS H3): one structured
 * JSON line per uncaught server error, which Vercel's runtime logs index and
 * can alert on. Only the path and route are logged, never headers, cookies
 * or bodies, so no session data reaches the logs.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      source: "questrix",
      message: message.slice(0, 500),
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
