import { revalidatePath } from "next/cache";
import { serviceDb } from "./db/server";
import { enqueue } from "./jobs";
import { advertPaymentsMode } from "./adapters/advert-checkout";
import { raiseInvoice, type InvoiceLink, type RaisedInvoice } from "./invoicing";

/**
 * Online payment for advertising (6 Oct): a priced run is held until it is
 * paid, then released. This module is the one place that decides whether to
 * hold, raises the invoice with its pay link, and settles it — whoever does
 * the settling (the Stripe webhook, the pay page's return, Jas marking a bank
 * transfer paid, or the local simulator).
 */

export const formatPounds = (pennies: number) => `£${(pennies / 100).toFixed(2)}`;

/**
 * Whether a run at this price waits for payment before it can go live.
 *
 * Never when payments are `off` (production without Stripe keys): holding
 * then would park a run nobody can pay for. Those runs schedule exactly as
 * they did before online payment existed, with an issued invoice for Jas to
 * collect by hand.
 */
export function holdsForPayment(pennies: number | null | undefined): pennies is number {
  return typeof pennies === "number" && pennies > 0 && advertPaymentsMode() !== "off";
}

/**
 * Raise the invoice for a held item and email the member a pay link.
 *
 * When nothing is held (unpriced, or payments off) this still raises the
 * invoice for a priced item — the pre-existing behaviour — but sends no pay
 * link, since there is nowhere to pay.
 */
export async function invoiceAdvertising(
  memberId: string,
  pennies: number | null | undefined,
  link: InvoiceLink,
): Promise<RaisedInvoice | null> {
  if (!pennies || pennies <= 0) return null;
  const invoice = await raiseInvoice(memberId, pennies, "ADV", link);
  if (invoice && holdsForPayment(pennies)) {
    await enqueue("notify_member", {
      member_id: memberId,
      kind: "advert_payment_due",
      invoice_id: invoice.id,
      invoice_ref: invoice.number,
      amount: formatPounds(pennies),
      ...(link.advert_booking_id ? { booking_id: link.advert_booking_id } : {}),
    });
  }
  return invoice;
}

export type SettleOptions = { sessionId?: string };
export type SettleResult = { settled: true; memberId: string } | { settled: false };

/**
 * Mark an invoice paid and release everything it was holding. Idempotent:
 * the conditional `issued → paid` update is the lock, so a webhook replay,
 * the return page and a double-clicked "Mark paid" can all call this and only
 * the first one does anything.
 *
 * A void invoice (its hold lapsed — see the advert_lifecycle sweep) is not
 * payable and settles nothing.
 */
export async function settleInvoice(invoiceId: string, opts: SettleOptions = {}): Promise<SettleResult> {
  const db = serviceDb();
  const now = new Date().toISOString();
  const { data: won } = await db
    .from("invoices")
    .update({ status: "paid", paid_at: now, ...(opts.sessionId ? { stripe_session_id: opts.sessionId } : {}) })
    .eq("id", invoiceId)
    .eq("status", "issued")
    .select("id, member_id, number, amount_pennies, advert_booking_id, bundle_id, placement_id");
  const invoice = won?.[0];
  if (!invoice) return { settled: false };

  // Held → scheduled. The run's own dates then decide whether it shows today
  // (liveBookings filters on status AND term), and the nightly sweep stamps
  // it live — so paying mid-term puts it on the site immediately.
  if (invoice.advert_booking_id) {
    await db.from("advert_bookings").update({ status: "scheduled", updated_at: now })
      .eq("id", invoice.advert_booking_id).eq("status", "awaiting_payment");
  }
  if (invoice.bundle_id) {
    await db.from("advert_bookings").update({ status: "scheduled", updated_at: now })
      .eq("bundle_id", invoice.bundle_id).eq("status", "awaiting_payment");
  }
  if (invoice.placement_id) {
    await db.from("placements").update({ awaiting_payment: false }).eq("id", invoice.placement_id);
  }

  await enqueue("notify_member", {
    member_id: invoice.member_id,
    kind: "advert_payment_received",
    invoice_id: invoice.id,
    invoice_ref: invoice.number,
    amount: formatPounds(invoice.amount_pennies),
    ...(invoice.advert_booking_id ? { booking_id: invoice.advert_booking_id } : {}),
  });

  for (const path of ["/", "/console", "/console/adverts", "/dashboard", "/dashboard/settings/billing"]) revalidatePath(path);
  return { settled: true, memberId: invoice.member_id };
}

/** The unpaid invoice holding a booking, if any — directly, or through its bundle. */
export async function openInvoiceFor(
  target: { advert_booking_id?: string | null; bundle_id?: string | null; placement_id?: string | null },
): Promise<{ id: string; number: string; amount_pennies: number; status: string } | null> {
  const db = serviceDb();
  const clauses = [
    target.advert_booking_id ? `advert_booking_id.eq.${target.advert_booking_id}` : null,
    target.bundle_id ? `bundle_id.eq.${target.bundle_id}` : null,
    target.placement_id ? `placement_id.eq.${target.placement_id}` : null,
  ].filter(Boolean);
  if (!clauses.length) return null;
  const { data } = await db
    .from("invoices")
    .select("id, number, amount_pennies, status")
    .or(clauses.join(","))
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}
