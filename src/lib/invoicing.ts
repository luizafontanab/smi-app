import { serviceDb } from "./db/server";

/**
 * Advert/visibility invoices are never online-paid — Jas invoices manually
 * (see visibility_requests' own migration comment). Unlike
 * applyPaymentResult()'s membership invoices, these land 'issued', not
 * 'paid'. There is currently no console action to flip one to 'paid' later;
 * that is a real, separate gap (out of scope here) — flagging so an invoice
 * raised by this helper isn't mistaken for something the system will resolve
 * on its own.
 */
export async function raiseInvoice(memberId: string, amountPennies: number, prefix: "ADV" | "VIS"): Promise<void> {
  if (amountPennies <= 0) return;
  const db = serviceDb();
  const now = new Date();
  const number = `SMI-${prefix}-${now.getTime().toString(36).toUpperCase()}`;
  await db.from("invoices").insert({
    member_id: memberId,
    number,
    amount_pennies: amountPennies,
    issued_on: now.toISOString().slice(0, 10),
    status: "issued",
  });
}
