"use client"; // error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { RetryButton } from "@/components/RetryButton";
import { reportClientError } from "@/lib/client-error-report";

/**
 * Public-site error boundary. Without it, any thrown server error renders
 * Next's bare digest screen with no header, footer or way back.
 *
 * Next 16 names the recovery prop `retry` (it was `reset` in earlier majors).
 * `error.message` is a generic string with a digest in production — the real
 * message stays server-side, which is why the digest is surfaced: it is the
 * only handle that ties a user report to the server log.
 */
export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[public] render error:", error);
    // Recorded server-side too (docs/logging.md); the digest ties it to the server's own entry.
    reportClientError({ message: error.message, stack: error.stack, digest: error.digest, kind: "boundary" });
  }, [error]);

  return (
    <div data-part="error-page" className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 data-part="page-title" className="text-3xl font-bold text-ink">Something went wrong at our end</h1>
      <p className="mt-4 text-graphite">
        This one is on us, not on you. Trying again often clears it — the page may have hit a
        temporary problem loading its content.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <RetryButton
          retry={retry}
          error={error}
          data-part="button-primary"
          className="rounded bg-ink px-4 py-2 font-semibold text-white hover:brightness-110"
        />
        <Link href="/" data-part="button-secondary" className="rounded border border-ink px-4 py-2 font-semibold text-ink hover:bg-ink/5">
          Back to the homepage
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-graphite">
          If you get in touch about this, quote reference <code className="font-mono">{error.digest}</code>.
        </p>
      )}
    </div>
  );
}
