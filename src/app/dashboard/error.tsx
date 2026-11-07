"use client"; // error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { RetryButton } from "@/components/RetryButton";
import { reportClientError } from "@/lib/client-error-report";

/** Member-area error boundary; renders inside the member layout chrome. */
export default function MemberError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-restricted-properties -- browser devtools copy; reportClientError below records it in the error log
    console.error("[member] render error:", error);
    // Recorded server-side too (docs/logging.md); the digest ties it to the server's own entry.
    reportClientError({ message: error.message, stack: error.stack, digest: error.digest, kind: "boundary" });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <h1 className="text-xl font-bold text-ink">This page failed to load</h1>
      <p className="mt-3 text-sm text-graphite">
        Your membership and anything you&apos;ve submitted are unaffected — this is a problem
        loading the page, not with your account.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <RetryButton
          retry={retry}
          error={error}
          className="rounded bg-ink px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        />
        <Link href="/dashboard" className="rounded border border-ink px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5">
          Back to dashboard
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-graphite">Reference {error.digest}</p>}
    </div>
  );
}
