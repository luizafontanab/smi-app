import { Suspense } from "react";
import { stopViewAs } from "@/app/view-as/actions";
import { ReadOnlyNotice } from "./ReadOnlyNotice";

/**
 * Above the member area's header whenever an admin is viewing as a member
 * (fix-list 94). Shade band rather than orange so it never reads as the grace
 * banner below it. "Back to console" is a form, not a link: leaving clears a
 * cookie, which only a server action can do.
 */
export function ViewAsBanner({ memberName }: { memberName: string }) {
  return (
    <div data-testid="view-as-banner" className="border-b border-line bg-shade text-ink">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <p className="min-w-0">
          <span className="mr-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-brand-text">Admin view</span>
          Viewing as <strong className="font-semibold">{memberName}</strong> — read-only. Nothing you change here is saved.
        </p>
        <form action={stopViewAs}>
          <button type="submit" className="tap rounded bg-ink px-3 py-1.5 font-semibold text-white hover:bg-chrome-hover">
            Back to console
          </button>
        </form>
      </div>
      <Suspense fallback={null}>
        <ReadOnlyNotice memberName={memberName} />
      </Suspense>
    </div>
  );
}
