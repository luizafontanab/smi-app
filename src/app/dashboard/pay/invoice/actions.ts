"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { siteUrl } from "@/lib/site-url";
import { UUID_RE } from "@/lib/validate";
import { advertPaymentsMode } from "@/lib/adapters/advert-checkout";
import { invoiceCheckoutSecret, settleInvoice } from "@/lib/advert-payments";
import { isPayableOnline } from "@/lib/invoicing";
import { logError } from "@/lib/log";

/**
 * The member's own unpaid advertising or visibility invoice, or null. Server
 * actions are reachable by direct POST, so the ownership check lives here and
 * not only on the page — and so does the kind check: a membership invoice is
 * paid through its subscription and must never reach this checkout.
 */
async function ownIssuedInvoice(invoiceId: string, memberId: string) {
  if (!UUID_RE.test(invoiceId)) return null;
  const { data } = await serviceDb()
    .from("invoices")
    .select("id, member_id, number, amount_pennies, status, description, checkout_session_id, checkout_expires_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!data || data.member_id !== memberId || data.status !== "issued" || !isPayableOnline(data)) return null;
  return data;
}

/**
 * Embedded Checkout's `fetchClientSecret` (6 Oct). The amount comes from the
 * invoice row, never from the browser — the client only names which invoice.
 *
 * Hands back the session already open for this invoice when there is one, so
 * a second tab or a reload can't open a second payable session.
 */
export async function createInvoiceCheckoutSession(invoiceId: string): Promise<string> {
  const user = await requireMember();
  const invoice = await ownIssuedInvoice(invoiceId, user.memberId);
  if (!invoice) throw new Error("This invoice can't be paid — it may already be paid.");
  if (advertPaymentsMode() !== "stripe") throw new Error("Online payment isn't available right now.");
  const result = await invoiceCheckoutSecret(
    invoice,
    { memberId: user.memberId, email: user.email || null },
    // Stripe swaps in the real session id; the page reads it back to settle at once.
    `${siteUrl()}/dashboard/pay/invoice/${invoice.id}?session_id={CHECKOUT_SESSION_ID}`,
  );
  if (!result.ok) {
    // Paid in the meantime (another tab, or the webhook got there first) is an
    // expected race, not a failure; anything else is Stripe or the database.
    if (result.alreadyPaid) console.warn(`[pay/invoice] ${invoice.number}: ${result.error}`);
    else logError({ source: "adapter", area: "action:createInvoiceCheckoutSession", error: result.error, context: { invoice_id: invoice.id } });
    throw new Error(result.alreadyPaid
      ? "This invoice has just been paid — refresh the page to see it."
      : "We couldn't start the payment. Please try again, or contact us.");
  }
  return result.clientSecret;
}

/**
 * Local dev and mock Previews only: pays the invoice without Stripe, through
 * the same settleInvoice() a real payment uses, so hold → pay → live can be
 * walked end to end with no account. Refused anywhere real money could move.
 */
export async function simulateInvoicePayment(formData: FormData) {
  const user = await requireMember();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (advertPaymentsMode() !== "simulated") redirect(`/dashboard/pay/invoice/${invoiceId}`);
  const invoice = await ownIssuedInvoice(invoiceId, user.memberId);
  if (invoice) await settleInvoice(invoice.id);
  redirect(`/dashboard/pay/invoice/${invoiceId}?paid=1`);
}
