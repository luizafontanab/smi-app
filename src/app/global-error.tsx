"use client"; // error boundaries must be Client Components

/**
 * Last resort: a failure in RootLayout itself, which this replaces. Per the
 * Next 16 docs it must render its own <html>/<body>, and it does NOT receive
 * global styles — so everything here is inline, and no Tailwind class is
 * relied upon. The likeliest trigger in this app is a missing Supabase env
 * var, which lib/db/server.ts throws on by design.
 *
 * `retry` is the Next 16 name for what earlier majors called `reset`.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      {/* Literal token values (ink/graphite/shade), not vars: this page renders
          without globals.css, so the palette has to be baked in. */}
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f4f5f6", color: "#111418" }}>
        <title>Something went wrong — Sheet Metal Industries</title>
        <main
          id="main"
          style={{ maxWidth: "34rem", margin: "0 auto", padding: "6rem 1rem", textAlign: "center" }}
        >
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>Sheet Metal Industries</h1>
          <p style={{ marginTop: "1.5rem", lineHeight: 1.6 }}>
            The site hit an unexpected problem and couldn&apos;t finish loading. We&apos;re sorry —
            please try again in a moment.
          </p>
          <button
            onClick={() => retry()}
            style={{
              marginTop: "2rem",
              padding: "0.6rem 1.2rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "#fff",
              background: "#111418",
              border: 0,
              borderRadius: "0.25rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#5a6068" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
