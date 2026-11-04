import Link from "next/link";
import type { ContentFilter, PendingSubmission, SubmissionKind, SubmissionStatus } from "@/lib/submissions";
import {
  requestContentChange, withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo,
} from "@/app/dashboard/actions";

// Partial on purpose: a queued page edit has nothing to withdraw — submitting
// the profile form again replaces the pending revision outright, which is what
// the page already tells the member.
const WITHDRAW: Partial<Record<SubmissionKind, (formData: FormData) => Promise<void>>> = {
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
  profile: "Your page",
};

/** The member's to edit — mirrors EDITABLE_STATUSES server-side; a story the member saved as a draft (memberDraft) is too. */
const EDITABLE: readonly SubmissionStatus[] = ["awaiting_approval", "rejected"];

function StatusText({ item }: { item: PendingSubmission }) {
  switch (item.status) {
    case "awaiting_approval":
      // Jas's name for the step (flow chart, 16 Oct) — stories and videos only;
      // events and equipment keep the older wording until their flow is reviewed.
      return <span className="text-brand-text">{item.kind === "story" || item.kind === "video" ? "ready to review" : "awaiting approval"}</span>;
    case "published":
      return <span className="text-success">live</span>;
    case "scheduled":
      return <span className="text-brand-text">scheduled</span>;
    case "draft":
      return <span className="text-graphite">{item.memberDraft ? "draft — only you can see it" : "draft"}</span>;
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
        const editable = EDITABLE.includes(s.status) || Boolean(s.memberDraft);
        // a draft is deleted from its editor, never withdrawn — it was never sent
        const withdrawable = EDITABLE.includes(s.status);
        const withdraw = WITHDRAW[s.kind];
        return (
          <div
            // editHref is not unique — every profile revision shares /dashboard/profile
            key={`${s.kind}:${s.id}`}
            className={`mt-2 border-t border-line pt-2 text-sm ${flush ? "first:mt-0 first:border-t-0 first:pt-0" : ""}`}
          >
            {/* Phones: badge + title, then the status on a line of its own, then
                the actions — the same place on every row. From sm up it is the
                original one-line row (#33 M5). */}
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3">
              <p className="min-w-0">
                <span className="mr-2 rounded bg-shade px-1.5 py-0.5 align-middle text-xs font-bold uppercase tracking-wide text-graphite sm:text-[11px]">
                  {KIND_LABELS[s.kind]}
                </span>
                {s.featured && (
                  <span title="A story that features you alongside another member" className="mr-2 rounded bg-brand/10 px-1.5 py-0.5 align-middle text-xs font-bold uppercase tracking-wide text-brand-text sm:text-[11px]">
                    Featured
                  </span>
                )}
                {s.title}<span className="hidden sm:inline"> — </span>
                <span className="mt-1 block font-semibold sm:mt-0 sm:inline sm:font-normal"><StatusText item={s} /></span>
              </p>
              <div className="-ml-1 flex flex-wrap items-center gap-x-3 text-sm sm:ml-0 sm:text-xs">
                {s.publicHref && (
                  <Link href={s.publicHref} className="tap px-1 text-graphite underline">View</Link>
                )}
                {s.previewHref && (
                  <a href={s.previewHref} target="_blank" rel="noopener" className="tap px-1 text-graphite underline">
                    Preview<span className="sr-only"> {s.title} as published (opens in a new tab)</span>
                  </a>
                )}
                {editable && (
                  <>
                    <Link href={s.editHref} className="tap px-1 text-graphite underline">Edit</Link>
                    {withdraw && withdrawable && (
                      <form action={withdraw}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="tap px-1 text-graphite underline hover:text-danger">Withdraw</button>
                      </form>
                    )}
                  </>
                )}
              </div>
            </div>

            {s.status === "published" && s.kind !== "profile" && !s.featured && (
              // <details> keeps the row compact until someone actually wants to
              // ask for something — no client JS needed for the toggle.
              <details className="mt-1.5">
                {/* Touch padding rather than .tap, whose inline-flex would
                    drop the summary's disclosure marker. */}
                <summary className="cursor-pointer py-1 text-sm text-graphite underline sm:text-xs [@media(pointer:coarse)]:py-3">Request a change</summary>
                <form action={requestContentChange} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="title" value={s.title} />
                  <input type="hidden" name="kind" value={KIND_LABELS[s.kind].toLowerCase()} />
                  {filter && <input type="hidden" name="filter" value={filter} />}
                  <input
                    name="note"
                    required
                    placeholder="What needs changing?"
                    aria-label={`What needs changing on ${s.title}?`}
                    className="min-w-0 flex-1 rounded border px-3 py-1.5 text-base sm:text-sm"
                  />
                  <button className="tap rounded bg-ink px-3 py-1.5 text-xs text-white">Send</button>
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
