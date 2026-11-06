import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { UUID_RE } from "@/lib/validate";
import { advertPaymentsMode, ADVERT_INVOICE_KIND, retrieveCheckoutSession, STRIPE_JS_URL, stripePublishableKey } from "@/lib/adapters/advert-checkout";
import { formatPounds, settleInvoice } from "@/lib/advert-payments";
import { isPayableOnline } from "@/lib/invoicing";
import { simulateInvoicePayment } from "../actions";
import { EmbeddedCheckout } from "./EmbeddedCheckout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay an invoice" };

/**
 * Pay one advertising invoice (6 Oct). Reached from the "payment due" email,
 * the advert's own page and the billing page.
 *
 * Stripe sends the member back here with `?session_id=` once they pay; the
 * session is read straight back and the invoice settled on the spot, so the
 * page says "paid" at once instead of waiting on the webhook. Both paths go
 * through settleInvoice(), which is idempotent — whichever is first wins.
 */
export default async function PayInvoicePage(props: PageProps<"/dashboard/pay/invoice/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMemberView();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();
  const load = () =>
    db.from("invoices")
      .select("id, member_id, number, amount_pennies, status, description, issued_on, paid_at, advert_booking_id")
      .eq("id", id)
      .maybeSingle();

  let { data: invoice } = await load();
  // service role bypasses RLS, so ownership is checked here — and the kind:
  // membership is paid by its subscription, never through this page (the
  // billing page offers no link to one, so a direct URL is the only way here)
  if (!invoice || invoice.member_id !== user.memberId || !isPayableOnline(invoice)) notFound();

  const mode = advertPaymentsMode();
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : null;
  // An admin viewing as the member (fix-list 94) only looks: no settling on
  // render (the webhook remains the authority) and no payment form below.
  const readOnly = user.viewingAs !== null;
  if (!readOnly && sessionId && invoice.status === "issued" && mode === "stripe") {
    const session = await retrieveCheckoutSession(sessionId);
    if (session?.kind === ADVERT_INVOICE_KIND && session.invoiceId === invoice.id && session.paymentStatus === "paid") {
      try {
        await settleInvoice(invoice.id, { sessionId, paid: { amountPennies: session.amountTotal, currency: session.currency } });
      } catch (e) {
        // The webhook is the authority and retries until it lands; the page
        // just shows "not confirmed yet" below rather than an error.
        console.error(`[pay/invoice] return-page settle failed for ${invoice.number}:`, e);
      }
      ({ data: invoice } = await load());
      if (!invoice) notFound();
    }
  }
  const publishableKey = stripePublishableKey();
  const back = invoice.advert_booking_id ? `/dashboard/advert/${invoice.advert_booking_id}` : "/dashboard/settings/billing";

  return (
    <div className="max-w-2xl lg:mx-auto">
      <Link href={back} className="text-sm text-graphite hover:text-ink">← Back</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">
        {invoice.status === "paid" ? "Paid — thank you" : "Pay your invoice"}
      </h1>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-graphite">For</dt>
          <dd className="text-ink">{invoice.description ?? "Advertising with Sheet Metal Industries"}</dd>
          <dt className="text-graphite">Reference</dt>
          <dd className="text-ink">{invoice.number}</dd>
          <dt className="text-graphite">Amount</dt>
          <dd className="font-semibold text-ink">{formatPounds(invoice.amount_pennies)}</dd>
        </dl>
      </section>

      {invoice.status === "paid" && (
        <p role="status" className="mt-4 rounded bg-success/10 p-3 text-sm text-success">
          {sp.paid || sessionId ? "Your payment has gone through. " : "This invoice is paid. "}
          Your advertising is confirmed and will run on its booked dates — we&apos;ve emailed you a receipt.
        </p>
      )}

      {invoice.status === "void" && (
        <p className="mt-4 rounded bg-ink/5 p-3 text-sm text-graphite">
          This invoice was cancelled and no longer needs paying. Get in touch if you&apos;d still like to book.
        </p>
      )}

      {invoice.status === "issued" && sessionId && (
        <p role="status" className="mt-4 rounded bg-brand/10 p-3 text-sm text-ink">
          We haven&apos;t received confirmation of that payment yet. If your bank is still processing it this page will update — otherwise you can try again below.
        </p>
      )}

      {invoice.status === "issued" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          {readOnly ? (
            // EmbeddedCheckout asks for a checkout session as it mounts — a member
            // action, which would bounce the admin straight back off this page.
            <p className="text-sm text-graphite">The payment form is hidden while you&apos;re viewing as a member.</p>
          ) : mode === "stripe" && publishableKey ? (
            <EmbeddedCheckout invoiceId={invoice.id} publishableKey={publishableKey} stripeJsUrl={STRIPE_JS_URL} />
          ) : mode === "simulated" ? (
            <form action={simulateInvoicePayment} className="space-y-3 text-sm">
              <input type="hidden" name="invoice_id" value={invoice.id} />
              <p className="text-graphite">
                Online payment is simulated in this environment — no card is charged. This settles the invoice the same way a real payment does.
              </p>
              <SubmitButton pendingLabel="Paying…" className="rounded bg-ink px-5 py-2.5 text-white">Pay {formatPounds(invoice.amount_pennies)} (simulated)</SubmitButton>
            </form>
          ) : (
            <p className="text-sm text-graphite">
              Online payment isn&apos;t available at the moment. We&apos;ll be in touch to arrange payment — quote reference {invoice.number}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
