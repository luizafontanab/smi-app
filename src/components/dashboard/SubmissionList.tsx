import Link from "next/link";
import type { ContentFilter, PendingSubmission, SubmissionKind, SubmissionStatus } from "@/lib/submissions";
import {
  requestContentChange, withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo,
} from "@/app/dashboard/actions";

const WITHDRAW: Record<SubmissionKind, (formData: FormData) => Promise<void>> = {
  story: withdrawStory,
  video: withdrawVideo,
  event: withdrawEvent,
  machine: withdrawMachine,
};

/**
 * What the member is shown, not the table name. A member's story is published as
 * news (`is_member_news`), and `featured_machines` is "equipment" everywhere
 * member-facing — /dashboard/equipment/[id]/edit included.
 */
const KIND_LABELS: Record<SubmissionKind, string> = {
  story: "News",
  video: "Video",
  event: "Event",
  machine: "Equipment",
};

/** Only these two are the member's to edit — mirrors EDITABLE_STATUSES server-side. */
const EDITABLE: readonly SubmissionStatus[] = ["awaiting_approval", "rejected"];

function StatusText({ item }: { item: PendingSubmission }) {
  switch (item.status) {
    case "awaiting_approval":
      return <span className="text-brand-text">awaiting approval</span>;
    case "published":
      return <span className="text-success">live</span>;
    case "scheduled":
      return <span className="text-brand-text">scheduled</span>;
    case "draft":
      return <span className="text-graphite">draft</span>;
    case "withdrawn":
      return <span className="text-graphite">withdrawn</span>;
    default:
      return <span className="text-danger">not published{item.rejected_reason && `: ${item.rejected_reason}`}</span>;
  }
}

/**
 * The rows of a member's own content — shared by the dashboard's "Your
 * submissions" box (most recent few, pre-approval only) and
 * /dashboard/submissions (everything, filterable).
 *
 * What a row offers depends on its status, and deliberately never exceeds what
 * the server will accept: only `awaiting_approval` and `rejected` are editable
 * or withdrawable. A published row gets a link to its live page and a "request a
 * change" note to Jas instead of an edit form — reopening a live page for
 * editing would take it off the site while it waited for re-approval.
 */
export function SubmissionList({ items, flush = false, filter }: {
  items: PendingSubmission[];
  /** Standalone card (no heading above the rows): drop the first row's rule and top gap. */
  flush?: boolean;
  /** Current tab, so a change request returns to it. */
  filter?: ContentFilter;
}) {
  return (
    <>
      {items.map((s) => {
        const editable = EDITABLE.includes(s.status);
        return (
          <div
            key={s.editHref}
            className={`mt-2 border-t pt-2 text-sm ${flush ? "first:mt-0 first:border-t-0 first:pt-0" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="min-w-0">
                <span className="mr-2 rounded bg-shade px-1.5 py-0.5 align-middle text-[11px] font-bold uppercase tracking-wide text-graphite">
                  {KIND_LABELS[s.kind]}
                </span>
                {s.title} — <StatusText item={s} />
              </p>
              <div className="flex items-center gap-3 text-xs">
                {s.publicHref && (
                  <Link href={s.publicHref} className="tap px-1 text-graphite underline">View</Link>
                )}
                {editable && (
                  <>
                    <Link href={s.editHref} className="tap px-1 text-graphite underline">Edit</Link>
                    <form action={WITHDRAW[s.kind]}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="tap px-1 text-graphite underline hover:text-danger">Withdraw</button>
                    </form>
                  </>
                )}
              </div>
            </div>

            {s.status === "published" && (
              // <details> keeps the row compact until someone actually wants to
              // ask for something — no client JS needed for the toggle.
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-graphite underline">Request a change</summary>
                <form action={requestContentChange} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="title" value={s.title} />
                  <input type="hidden" name="kind" value={KIND_LABELS[s.kind].toLowerCase()} />
                  {filter && <input type="hidden" name="filter" value={filter} />}
                  <input
                    name="note"
                    required
                    placeholder="What needs changing?"
                    aria-label={`What needs changing on ${s.title}?`}
                    className="min-w-0 flex-1 rounded border px-3 py-1.5 text-sm"
                  />
                  <button className="rounded bg-ink px-3 py-1.5 text-xs text-white">Send</button>
                </form>
                <p className="mt-1 text-xs text-graphite">Goes to the SMI editor. Your page stays live in the meantime.</p>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
