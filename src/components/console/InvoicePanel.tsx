import { holdsForPayment, openInvoiceFor, formatPounds } from "@/lib/advert-payments";
import { markInvoicePaid, raiseItemInvoice } from "@/app/console/actions";
import { Badge } from "./ui";

/** What the page knows about the item that the invoice table doesn't: its price, and whether it's billable yet. */
export type RaiseInvoice = { kind: "booking" | "bundle" | "placement"; id: string; pricePennies: number | null; billable: boolean };

/**
 * The invoice behind a booking, bundle or placement, and whether it's paid —
 * with "Mark paid" for money that arrived outside Stripe (6 Oct), and "Raise
 * invoice" for a priced item that has none (its invoice failed when it was
 * booked, or was cancelled). Renders nothing for an item never invoiced that
 * has nothing to invoice.
 */
export async function InvoicePanel({
  target,
  returnTo,
  raise,
}: {
  target: { advert_booking_id?: string | null; bundle_id?: string | null; placement_id?: string | null };
  returnTo: string;
  raise?: RaiseInvoice;
}) {
  const invoice = await openInvoiceFor(target);
  const canRaise = Boolean(raise?.billable && raise.pricePennies && raise.pricePennies > 0 && (!invoice || invoice.status === "void"));
  if (!invoice && !canRaise) return null;
  const raiseForm = canRaise && raise && (
    <form action={raiseItemInvoice} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <input type="hidden" name="kind" value={raise.kind} />
      <input type="hidden" name="id" value={raise.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button className="rounded bg-ink px-3 py-1.5 text-white">Raise invoice</button>
      <span className="text-xs text-graphite">
        For {formatPounds(raise.pricePennies!)}.{" "}
        {holdsForPayment(raise.pricePennies)
          ? <>The member is emailed the pay link; if it hasn&apos;t started, it&apos;s held until they pay.</>
          : <>Online payment is off, so nothing is emailed — collect it by hand.</>}
      </span>
    </form>
  );
  if (!invoice) {
    return (
      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-ink">Invoice</h2>
          <Badge tone="red">not invoiced</Badge>
        </div>
        <p className="mt-1 text-sm text-graphite">This is priced but has no invoice, so the member has nothing to pay.</p>
        {raiseForm}
      </section>
    );
  }
  const tone = invoice.status === "paid" ? "green" : invoice.status === "void" ? "neutral" : "brand";
  const label = invoice.status === "issued" ? "awaiting payment" : invoice.status;

  return (
    <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-ink">Invoice</h2>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-1 text-sm text-graphite">
        {invoice.number} · {formatPounds(invoice.amount_pennies)}
      </p>
      {invoice.status === "issued" && (
        <form action={markInvoicePaid} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirm" value="1" required />
            The payment arrived outside Stripe (bank transfer, cheque)
          </label>
          <button className="rounded border px-3 py-1.5 text-graphite hover:text-ink">Mark paid</button>
        </form>
      )}
      {raiseForm}
      {invoice.status === "issued" && (
        <p className="mt-2 text-xs text-graphite">
          The member has a pay link by email and on their billing page. Marking it paid here releases the run and sends them a receipt, the same as a card payment.
        </p>
      )}
    </section>
  );
}
