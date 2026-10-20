"use client";

import { useSearchParams } from "next/navigation";

/**
 * A refused member action (lib/auth requireMember) bounces an admin back with
 * `?readonly=1`. A layout never sees searchParams, so this reads them here.
 */
export function ReadOnlyNotice({ memberName }: { memberName: string }) {
  if (useSearchParams().get("readonly") !== "1") return null;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-2">
      <p role="alert" className="rounded bg-danger/10 p-2 text-sm text-danger">
        That change wasn&apos;t saved — you&apos;re viewing as {memberName}, which is read-only.
      </p>
    </div>
  );
}
