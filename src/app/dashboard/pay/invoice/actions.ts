"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { siteUrl } from "@/lib/site-url";
import { UUID_RE } from "@/lib/validate";
import { advertPaymentsMode, createInvoiceCheckout } from "@/lib/adapters/advert-checkout";
import { settleInvoice } from "@/lib/advert-payments";

/**
 * The member's own unpaid invoice, or null. Server actions are reachable by
 * direct POST, so the ownership check lives here and not only on the page.
 */
async function ownIssuedInvoice(invoiceId: string, memberId: string) {
  if (!UUID_RE.test(invoiceId)) return null;
  const { data } = await serviceDb()
    .from("invoices")
    .select("id, member_id, number, amount_pennies, status, description")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!data || data.member_id !== memberId || data.status !== "issued") return null;
  return data;
}

/**
 * Embedded Checkout's `fetchClientSecret` (6 Oct). The amount comes from the
 * invoice row, never from the browser — the client only names which invoice.
 */
export async function createInvoiceCheckoutSession(invoiceId: string): Promise<string> {
  const user = await requireMember();
  const invoice = await ownIssuedInvoice(invoiceId, user.memberId);
  if (!invoice) throw new Error("This invoice can't be paid — it may already be paid.");
  if (advertPaymentsMode() !== "stripe") throw new Error("Online payment isn't available right now.");
  const result = await createInvoiceCheckout({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    memberId: user.memberId,
    email: user.email || null,
    description: invoice.description ?? `Sheet Metal Industries — ${invoice.number}`,
    amountPennies: invoice.amount_pennies,
    // Stripe swaps in the real session id; the page reads it back to settle at once.
    returnUrl: `${siteUrl()}/dashboard/pay/invoice/${invoice.id}?session_id={CHECKOUT_SESSION_ID}`,
  });
  if (!result.ok) {
    console.error(`[pay/invoice] ${invoice.number}: ${result.error}`);
    throw new Error("We couldn't start the payment. Please try again, or contact us.");
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
