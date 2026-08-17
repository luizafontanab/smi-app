"use client"; // error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

/** Member-area error boundary; renders inside the member layout chrome. */
export default function MemberError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[member] render error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <h1 className="text-xl font-bold text-navy">This page failed to load</h1>
      <p className="mt-3 text-sm text-gray-600">
        Your membership and anything you&apos;ve submitted are unaffected — this is a problem
        loading the page, not with your account.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={() => retry()}
          className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          Try again
        </button>
        <Link href="/member" className="rounded border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5">
          Back to dashboard
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-gray-400">Reference {error.digest}</p>}
    </div>
  );
}
