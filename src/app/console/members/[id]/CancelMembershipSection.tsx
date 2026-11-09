import { Card, SectionTitle } from "@/components/console/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { membershipCancelState, type MemberStatus } from "@/lib/membership";
import { INVOICE_BILLING_LINE, scheduledOn } from "../../membership-messages";

type Member = { id: string; status: MemberStatus; billing_mode: string; cancel_requested_at: string | null };

/**
 * The console member page's Cancel membership section (#90). What it shows
 * comes from `membershipCancelState`, the same rule the action enforces:
 * nothing for draft or lapsed members, a line for invoice billing, the Cancel
 * action for a card member with nothing pending, and the scheduled date with
 * the Undo cancellation action (#92) once a cancel is pending.
 */
export function CancelMembershipSection({ member, cancel, undo }: {
  member: Member;
  cancel: (fd: FormData) => Promise<void>;
  undo: (fd: FormData) => Promise<void>;
}) {
  const state = membershipCancelState(member);
  if (state === "none") return null;
  return (
    <Card id="cancel-membership" className="mt-4 border-danger/30">
      <SectionTitle>Cancel membership</SectionTitle>
      {state === "invoice" && <p className="mt-1 text-sm text-graphite">{INVOICE_BILLING_LINE}</p>}
      {state === "cancellable" && (
        <>
          <p className="mt-1 text-sm text-graphite">
            For a member who has asked SMI to cancel. Stops their card subscription renewing at the end of the period
            they&apos;ve paid for, never immediately, and emails them that the cancellation is scheduled.
          </p>
          <ConfirmedMembershipAction
            action={cancel}
            memberId={member.id}
            confirmLabel="Yes, cancel this membership"
            buttonLabel="Cancel membership"
            pendingLabel="Cancelling…"
          />
        </>
      )}
      {state === "pending" && member.cancel_requested_at && (
        <>
          <p className="mt-1 text-sm text-ink">
            Cancellation scheduled on {scheduledOn(member.cancel_requested_at)}. Ends at the close of the paid period.
          </p>
          <p className="mt-2 text-sm text-graphite">
            If the member has changed their mind, undo it: their card subscription keeps renewing, and they&apos;re
            emailed that their membership will continue.
          </p>
          <ConfirmedMembershipAction
            action={undo}
            memberId={member.id}
            confirmLabel="Yes, undo this cancellation"
            buttonLabel="Undo cancellation"
            pendingLabel="Undoing…"
          />
        </>
      )}
    </Card>
  );
}

/**
 * One tick-to-confirm action, posting `id` and `confirm=1` — the same shape as
 * CancelPlacementForm: a required confirm box, and the action refuses (and says
 * why) if the form is posted without it anyway.
 */
function ConfirmedMembershipAction({ action, memberId, confirmLabel, buttonLabel, pendingLabel }: {
  action: (fd: FormData) => Promise<void>;
  memberId: string;
  confirmLabel: string;
  buttonLabel: string;
  pendingLabel: string;
}) {
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={memberId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="1" required />
        {confirmLabel}
      </label>
      <SubmitButton pendingLabel={pendingLabel} className="rounded border border-danger/30 px-4 py-2 text-sm text-danger disabled:opacity-50">
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}
