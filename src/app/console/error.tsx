"use client"; // error boundaries must be Client Components

import { useEffect } from "react";
import { RetryButton } from "@/components/RetryButton";
import { reportClientError } from "@/lib/client-error-report";

/**
 * Console error boundary. Operators need the digest to report a problem, and
 * they need the surrounding console chrome to stay usable — this renders
 * inside the console layout, so the nav is still there.
 */
export default function ConsoleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[console] render error:", error);
    // Recorded server-side too (docs/logging.md); the digest ties it to the server's own entry.
    reportClientError({ message: error.message, stack: error.stack, digest: error.digest, kind: "boundary" });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <h1 className="text-xl font-bold text-ink">This screen failed to load</h1>
      <p className="mt-3 text-sm text-graphite">
        Nothing has been saved or lost — the page just couldn&apos;t finish loading its data.
      </p>
      <RetryButton
        retry={retry}
        error={error}
        className="mt-6 rounded bg-ink px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
      />
      {error.digest && <p className="mt-6 text-xs text-graphite">Reference {error.digest}</p>}
    </div>
  );
}
