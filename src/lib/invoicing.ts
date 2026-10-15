import { serviceDb } from "./db/server";

/** What an advert invoice pays for — at most one is set. Shown to the member as `description`. */
export type InvoiceLink = {
  description?: string;
  advert_booking_id?: string;
  bundle_id?: string;
  placement_id?: string;
};

export type RaisedInvoice = { id: string; number: string };

/**
 * Advert and visibility invoices. Unlike applyPaymentResult()'s membership
 * invoices, these land 'issued', not 'paid'.
 *
 * Since 6 Oct they can be paid online: the link says what the invoice is
 * for, so settleInvoice() (src/lib/advert-payments.ts) knows which held runs
 * a payment releases, and returning the row's id lets the caller put a pay
 * link in the member's email. Jas can still mark one paid by hand from the
 * console (bank transfer), through the same settleInvoice().
 *
 * Returns null when nothing was raised — a zero amount, or a failed insert,
 * which is logged rather than thrown: the booking it belongs to has already
 * been written, and losing the invoice is recoverable by hand where losing
 * the booking's redirect is not.
 */
export async function raiseInvoice(
  memberId: string,
  amountPennies: number,
  prefix: "ADV" | "VIS",
  link: InvoiceLink = {},
): Promise<RaisedInvoice | null> {
  if (amountPennies <= 0) return null;
  const db = serviceDb();
  const now = new Date();
  const number = `SMI-${prefix}-${now.getTime().toString(36).toUpperCase()}`;
  const { data, error } = await db.from("invoices").insert({
    member_id: memberId,
    number,
    amount_pennies: amountPennies,
    issued_on: now.toISOString().slice(0, 10),
    status: "issued",
    description: link.description ?? null,
    advert_booking_id: link.advert_booking_id ?? null,
    bundle_id: link.bundle_id ?? null,
    placement_id: link.placement_id ?? null,
  }).select("id").single();
  if (error || !data) {
    console.error(`raiseInvoice: ${number} for member ${memberId} was not stored: ${error?.message ?? "no row returned"}`);
    return null;
  }
  return { id: data.id, number };
}
