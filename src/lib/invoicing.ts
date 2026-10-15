import { randomInt } from "node:crypto";
import { serviceDb } from "./db/server";

/** What an advert invoice pays for — at most one is set. Shown to the member as `description`. */
export type InvoiceLink = {
  description?: string;
  advert_booking_id?: string;
  bundle_id?: string;
  placement_id?: string;
};

export type RaisedInvoice = { id: string; number: string };

export type InvoicePrefix = "ADV" | "VIS" | "JOIN";

/**
 * `SMI-<prefix>-<ms base36>-<4 random base36>`, e.g. SMI-ADV-MG3K2Q7F-4K9Z.
 *
 * The timestamp part keeps numbers roughly in issue order and recognisable to
 * anyone used to the old format; the random suffix is what stops two invoices
 * raised in the same millisecond (a double-clicked Approve, two bundle parts in
 * one loop) colliding on `invoices.number`'s unique constraint. 36⁴ is 1.7m, and
 * a collision that still slips through is retried by insertInvoice() below.
 */
export function invoiceNumber(prefix: InvoicePrefix, now = new Date()): string {
  const suffix = randomInt(36 ** 4).toString(36).padStart(4, "0");
  return `SMI-${prefix}-${now.getTime().toString(36)}-${suffix}`.toUpperCase();
}

/**
 * Whether the member pays this invoice online, through /dashboard/pay/invoice.
 * Only advertising (ADV) and visibility (VIS) invoices are: membership is paid
 * by its own Stripe subscription, so an issued SMI-JOIN invoice — or one of the
 * seed's older `SMI-2026-…` membership rows — must never get a pay link, or the
 * member could pay the £40 twice through a checkout that knows nothing of their
 * subscription.
 */
export function isPayableOnline(invoice: { number: string }): boolean {
  return /^SMI-(ADV|VIS)-/.test(invoice.number);
}

export type InvoiceResult =
  | { ok: true; invoice: RaisedInvoice; created: boolean }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";
const ATTEMPTS = 3;

type PgError = { code?: string; message: string };

/**
 * Insert one issued invoice. A number collision is retried with a fresh number;
 * a collision on the one-issued-invoice-per-item indexes (20261016000001) is
 * returned as `duplicate`, for ensureInvoice() to resolve to the winning row.
 */
async function insertInvoice(
  memberId: string,
  amountPennies: number,
  prefix: "ADV" | "VIS",
  link: InvoiceLink,
): Promise<{ ok: true; invoice: RaisedInvoice } | { ok: false; duplicate: boolean; error: string }> {
  const db = serviceDb();
  let last: PgError | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = new Date();
    const number = invoiceNumber(prefix, now);
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
    if (!error && data) return { ok: true, invoice: { id: data.id, number } };
    last = error ?? { message: "no row returned" };
    if (error?.code === UNIQUE_VIOLATION && error.message.includes("invoices_number_key")) continue;
    if (error?.code === UNIQUE_VIOLATION && error.message.includes("invoices_one_issued_per_")) {
      return { ok: false, duplicate: true, error: error.message };
    }
    break;
  }
  return { ok: false, duplicate: false, error: last?.message ?? "unknown error" };
}

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
 * the booking's redirect is not. An item that already has an issued invoice
 * is one such failure (20261016000001) — prefer ensureInvoice() for anything
 * linked, which returns that invoice instead and says why when it can't.
 */
export async function raiseInvoice(
  memberId: string,
  amountPennies: number,
  prefix: "ADV" | "VIS",
  link: InvoiceLink = {},
): Promise<RaisedInvoice | null> {
  if (amountPennies <= 0) return null;
  const result = await insertInvoice(memberId, amountPennies, prefix, link);
  if (!result.ok) {
    console.error(`raiseInvoice: ${prefix} invoice for member ${memberId} was not stored: ${result.error}`);
    return null;
  }
  return result.invoice;
}

type LinkColumn = "advert_booking_id" | "bundle_id" | "placement_id";

/** The one link column set, or null when none or several are. */
export function linkColumn(link: Pick<InvoiceLink, LinkColumn>): { column: LinkColumn; id: string } | null {
  const set = (["advert_booking_id", "bundle_id", "placement_id"] as const).filter((c) => link[c]);
  return set.length === 1 ? { column: set[0], id: link[set[0]]! } : null;
}

/**
 * The invoice for one booking, bundle or placement — the existing issued or
 * paid one if there is one, otherwise a newly raised one. Idempotent, so a
 * double-clicked "Raise invoice" or a retried approval can call it freely:
 * a concurrent duplicate loses on the one-issued-per-item index and resolves
 * to the row that won.
 *
 * Refuses (ok: false) rather than guessing when the invoice on record is for a
 * different member or amount: that is a re-price or a change of member, and
 * the old invoice has to be voided first (voidInvoices() in advert-payments.ts)
 * so the member is never left holding two pay links. A paid invoice on record
 * with different terms is refused for the same reason — the difference needs a
 * decision, not a second invoice.
 *
 * `created` is true only when this call raised it — the caller's cue to email
 * a pay link, which a repeat call must not send again.
 */
export async function ensureInvoice(
  memberId: string,
  amountPennies: number,
  prefix: "ADV" | "VIS",
  link: InvoiceLink,
): Promise<InvoiceResult> {
  if (!Number.isInteger(amountPennies) || amountPennies <= 0) return { ok: false, error: "An invoice needs an amount above zero." };
  const target = linkColumn(link);
  if (!target) return { ok: false, error: "An invoice must be for exactly one booking, bundle or placement." };

  const db = serviceDb();
  const existing = async (): Promise<InvoiceResult | null> => {
    const { data, error } = await db
      .from("invoices")
      .select("id, number, member_id, amount_pennies, status")
      .eq(target.column, target.id)
      .in("status", ["issued", "paid"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return { ok: false, error: `Could not read the existing invoice: ${error.message}` };
    const row = data?.[0];
    if (!row) return null;
    if (row.member_id !== memberId || row.amount_pennies !== amountPennies) {
      return {
        ok: false,
        error: row.status === "paid"
          ? `${row.number} is already paid for this, on different terms — sort the difference out by hand.`
          : `${row.number} is already open for this, on different terms — void it before raising another.`,
      };
    }
    return { ok: true, invoice: { id: row.id, number: row.number }, created: false };
  };

  const found = await existing();
  if (found) return found;
  const inserted = await insertInvoice(memberId, amountPennies, prefix, link);
  if (inserted.ok) return { ok: true, invoice: inserted.invoice, created: true };
  if (inserted.duplicate) {
    const winner = await existing();
    if (winner) return winner;
  }
  console.error(`ensureInvoice: ${prefix} invoice for ${target.column} ${target.id} was not stored: ${inserted.error}`);
  return { ok: false, error: `The invoice could not be stored: ${inserted.error}` };
}
