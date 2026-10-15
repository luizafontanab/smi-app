import { openInvoiceFor, formatPounds } from "@/lib/advert-payments";
import { markInvoicePaid } from "@/app/console/actions";
import { Badge } from "./ui";

/**
 * The invoice behind a booking, bundle or placement, and whether it's paid —
 * with "Mark paid" for money that arrived outside Stripe (6 Oct). Renders
 * nothing when the item was never invoiced.
 */
export async function InvoicePanel({
  target,
  returnTo,
}: {
  target: { advert_booking_id?: string | null; bundle_id?: string | null; placement_id?: string | null };
  returnTo: string;
}) {
  const invoice = await openInvoiceFor(target);
  if (!invoice) return null;
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
      {invoice.status === "issued" && (
        <p className="mt-2 text-xs text-graphite">
          The member has a pay link by email and on their billing page. Marking it paid here releases the run and sends them a receipt, the same as a card payment.
        </p>
      )}
    </section>
  );
}
