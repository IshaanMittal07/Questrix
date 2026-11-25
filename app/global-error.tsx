"use client";

/** Last-resort boundary: replaces the root layout, so it brings its own html. */
export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#070a12",
          color: "#e8ecf8",
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
        }}
      >
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1>Something went wrong</h1>
          <p>Your progress is saved. Please try again.</p>
          <button
            onClick={() => retry()}
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 12 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
