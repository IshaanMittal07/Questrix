/**
 * Inline script that runs synchronously during HTML parsing (before first paint).
 * Pattern from the Next.js "Preventing flash before hydration" guide: render as
 * executable on the server, inert on the client, and suppress the type mismatch.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
