import Link from "next/link";
import type { PendingSubmission, SubmissionKind } from "@/lib/submissions";
import { withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo } from "@/app/dashboard/actions";

const WITHDRAW: Record<SubmissionKind, (formData: FormData) => Promise<void>> = {
  story: withdrawStory,
  video: withdrawVideo,
  event: withdrawEvent,
  machine: withdrawMachine,
};

/**
 * The rows of a member's pre-approval queue — shared by the dashboard's
 * "Your submissions" box (most recent few) and /dashboard/submissions (all).
 * Each row has its own edit page and withdraw action.
 */
export function SubmissionList({ items, flush = false }: {
  items: PendingSubmission[];
  /** Standalone card (no heading above the rows): drop the first row's rule and top gap. */
  flush?: boolean;
}) {
  return (
    <>
      {items.map((s) => (
        <div
          key={s.editHref}
          className={`mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-sm ${flush ? "first:mt-0 first:border-t-0 first:pt-0" : ""}`}
        >
          <p>
            {s.title} —{" "}
            {s.status === "awaiting_approval"
              ? <span className="text-brand-text">awaiting approval</span>
              : <span className="text-danger">not published{s.rejected_reason && `: ${s.rejected_reason}`}</span>}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <Link href={s.editHref} className="tap px-1 text-graphite underline">Edit</Link>
            <form action={WITHDRAW[s.kind]}>
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" className="tap px-1 text-graphite underline hover:text-danger">Withdraw</button>
            </form>
          </div>
        </div>
      ))}
    </>
  );
}
