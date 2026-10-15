import "server-only";
import { serviceDb } from "@/lib/db/server";
import { holdsForPayment, invoiceAdvertising, voidInvoices } from "@/lib/advert-payments";
import { PRICE_MAX_PENNIES, PRICE_MIN_PENNIES } from "@/lib/pricing";
import { logError } from "@/lib/log";

/**
 * Billing for the things the console sells — a booked run, a bundle, a
 * Featured Member slot or a takeover — after the first save.
 *
 * Booking something new has always raised its invoice. What was missing is
 * everything after: a failed invoice left a run held with no pay link and Jas
 * told "Saved"; a price added to an edit was recorded and never billed; a
 * changed price or member left the old invoice payable, so the old member's
 * payment released the new member's slot. This module is the one place that
 * reconciles an item's invoice with its stored price and member:
 *
 * - repricePlan()  — pure: given what's on record and what the save will
 *                    write, keep / replace / refuse / flag a paid difference.
 * - voidForReprice — void the issued invoice before the save (expiring any
 *                    open Stripe session, voidInvoices()), refusing if the
 *                    member is paying it this minute.
 * - billItem()     — raise the invoice for the item as stored (idempotent,
 *                    ensureInvoice()), and hold it for payment when it's a
 *                    price newly added to something that hasn't started.
 * - releaseHold()  — a price taken off a held item: nothing is owed now.
 *
 * Not a "use server" module: actions.ts may only export async functions.
 */

/** The one thing an invoice pays for (exactly one key — the invoices_one_link check). */
export type BillTarget = { advert_booking_id: string } | { bundle_id: string } | { placement_id: string };

export type OnRecord = { id: string; number: string; member_id: string; amount_pennies: number; status: "issued" | "paid" };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Jas reads these on the page, so Postgres's wording stays in the error log:
 * a helper's "Could not void invoice …: <database text>" is shown up to the
 * colon, and the whole of it is logged.
 */
function plain(area: string, message: string): string {
  const cut = message.indexOf(": ");
  if (cut < 0) return message;
  logError({ source: "db", area, error: message });
  return `${message.slice(0, cut)}.`;
}

function dbFail(area: string, error: { message: string; code?: string }, sentence: string): { ok: false; error: string } {
  logError({ source: "db", area, error: error.message, context: { code: error.code ?? null } });
  return { ok: false, error: sentence };
}

const READ_FAILED = "It couldn't be read just now — try again.";

/** The console's one wording for a price it can't take — the limits are Stripe's (lib/pricing). */
export function priceError(example: string): string {
  const fmt = (p: number) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  return `Enter the price in pounds, e.g. ${example} — between ${fmt(PRICE_MIN_PENNIES)} and ${fmt(PRICE_MAX_PENNIES)}, at most two decimal places — or leave it blank.`;
}

/** What Jas is told when the save landed but its invoice didn't. */
export function invoiceFailedMessage(error: string): string {
  return `Saved, but the invoice couldn't be raised — use Raise invoice below to try again. (${plain("billing:invoice", error)})`;
}

function linkOf(target: BillTarget): { column: "advert_booking_id" | "bundle_id" | "placement_id"; id: string } {
  if ("advert_booking_id" in target) return { column: "advert_booking_id", id: target.advert_booking_id };
  if ("bundle_id" in target) return { column: "bundle_id", id: target.bundle_id };
  return { column: "placement_id", id: target.placement_id };
}

/** The item's live invoice: the newest issued or paid one. Voided ones are history. */
export async function invoiceOnRecord(target: BillTarget): Promise<{ ok: true; invoice: OnRecord | null } | { ok: false; error: string }> {
  const { column, id } = linkOf(target);
  const { data, error } = await serviceDb()
    .from("invoices")
    .select("id, number, member_id, amount_pennies, status")
    .eq(column, id)
    .in("status", ["issued", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return dbFail("billing:invoiceOnRecord", error, `The invoice on record couldn't be read just now — nothing was changed. Try again.`);
  return { ok: true, invoice: (data?.[0] as OnRecord | undefined) ?? null };
}

export type Reprice =
  /** nothing on record, or on record at exactly these terms */
  | { action: "keep" }
  /** issued and unpaid at other terms: void it before the save, raise afresh after */
  | { action: "replace"; invoice: OnRecord }
  /** the change can't be made without a decision Jas has to take */
  | { action: "refuse"; error: string }
  /** paid at another price: the price is recorded, the difference is settled by hand */
  | { action: "paid_differs"; invoice: OnRecord };

/**
 * What a save that will write `next` must do about the invoice on record.
 *
 * An unpaid invoice is replaced rather than kept: left as it was, a new price
 * would be billed at the old one, and a new member's slot would be released by
 * the old member paying. A paid invoice is never touched — it is the record of
 * money taken. A paid slot can't change hands (the payer would lose what they
 * paid for to someone who hasn't); a paid item can be re-priced, but nothing
 * is billed for the difference automatically — "re-invoicing would bill twice".
 */
export function repricePlan(onRecord: OnRecord | null, next: { memberId: string | null; pricePennies: number | null }): Reprice {
  if (!onRecord) return { action: "keep" };
  const sameMember = next.memberId === onRecord.member_id;
  const samePrice = next.pricePennies === onRecord.amount_pennies;
  if (onRecord.status === "paid") {
    if (!sameMember) {
      return {
        action: "refuse",
        error: `${onRecord.number} has already been paid by the member this is booked to, so it can't move to another member. Book the new member their own.`,
      };
    }
    return samePrice ? { action: "keep" } : { action: "paid_differs", invoice: onRecord };
  }
  return sameMember && samePrice ? { action: "keep" } : { action: "replace", invoice: onRecord };
}

/** The warning for a paid item whose price changed. */
export function paidDiffersMessage(invoice: OnRecord, pricePennies: number | null): string {
  const was = `£${(invoice.amount_pennies / 100).toFixed(2)}`;
  const now = pricePennies ? `£${(pricePennies / 100).toFixed(2)}` : "no price";
  return `Saved. ${invoice.number} was already paid at ${was}; the new price (${now}) isn't billed — settle the difference by hand.`;
}

/**
 * Void the item's issued invoice so a re-priced or re-assigned one can replace
 * it. Refuses when a Stripe Checkout for it has already completed: the member
 * is paying it right now, and the webhook will settle it.
 */
export async function voidForReprice(target: BillTarget): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await voidInvoices(target);
  if (!result.ok) return { ok: false, error: `${plain("billing:voidForReprice", result.error)} Nothing was changed.` };
  if (result.paying.length) {
    return { ok: false, error: "The member is paying the current invoice right now, so nothing was changed. Look again in a few minutes — once it's paid, it's settled at that price." };
  }
  return { ok: true };
}

export type BillResult = { ok: true; invoice: { id: string; number: string } | null } | { ok: false; error: string };

type BookingRow = {
  status: string;
  price_pennies: number | null;
  bundle_id: string | null;
  starts_on: string;
  ends_on: string;
  advert: { member_id: string; name: string } | null;
};

/**
 * Runs that can be billed: approved (before that, approving is what invoices
 * them) and not over — an ended run may have been called off unpaid, and
 * re-billing it is a conversation, not a button.
 */
const BILLABLE_RUN = ["awaiting_payment", "scheduled", "live"];

/**
 * Raise the invoice for an item at its stored price and member — idempotent
 * (ensureInvoice), so it returns the one already on record rather than a
 * second. An unpriced item, or a run not approved yet, is `invoice: null`.
 *
 * `hold`: when this call raised the invoice and payments are live, put a run,
 * bundle part or placement that hasn't started yet on hold until it's paid —
 * what booking it priced in the first place would have done. Anything already
 * running stays on the site: the invoice is due, but pulling a live advert off
 * because a price was added afterwards would be a surprise to everyone.
 */
export async function billItem(target: BillTarget, opts: { hold: boolean }): Promise<BillResult> {
  const db = serviceDb();
  const now = new Date().toISOString();

  if ("placement_id" in target) {
    const { data: p, error } = await db
      .from("placements")
      .select("id, kind, member_id, price_pennies, starts_on, ends_on, awaiting_payment")
      .eq("id", target.placement_id)
      .maybeSingle();
    if (error) return dbFail("billing:placement", error, READ_FAILED);
    if (!p) return { ok: false, error: "That booking no longer exists." };
    if (!p.member_id || !p.price_pennies) return { ok: true, invoice: null };
    const what = p.kind === "takeover" ? "Homepage takeover" : p.kind === "featured_member" ? "Featured Member slot" : "Featured placement";
    const result = await invoiceAdvertising(p.member_id, p.price_pennies, {
      placement_id: p.id,
      description: `${what} (${p.starts_on} to ${p.ends_on})`,
    });
    if (!result) return { ok: true, invoice: null };
    if (!result.ok) return { ok: false, error: plain("billing:invoice", result.error) };
    if (opts.hold && result.created && holdsForPayment(p.price_pennies) && p.starts_on > today() && !p.awaiting_payment) {
      const { error: holdError } = await db.from("placements").update({ awaiting_payment: true }).eq("id", p.id);
      if (holdError) return dbFail("billing:hold", holdError, "Invoiced, but it couldn't be held for payment — it may show before it's paid.");
    }
    return { ok: true, invoice: result.invoice };
  }

  if ("advert_booking_id" in target) {
    const { data, error } = await db
      .from("advert_bookings")
      .select("status, price_pennies, bundle_id, starts_on, ends_on, advert:adverts(member_id, name)")
      .eq("id", target.advert_booking_id)
      .maybeSingle();
    if (error) return dbFail("billing:booking", error, READ_FAILED);
    const b = data as BookingRow | null;
    if (!b) return { ok: false, error: "That booking no longer exists." };
    // A bundle part with no price of its own is paid for by the bundle.
    if (!b.price_pennies && b.bundle_id) return billItem({ bundle_id: b.bundle_id }, opts);
    if (!b.price_pennies || !b.advert?.member_id || !BILLABLE_RUN.includes(b.status)) return { ok: true, invoice: null };
    const result = await invoiceAdvertising(b.advert.member_id, b.price_pennies, {
      advert_booking_id: target.advert_booking_id,
      description: `Advert: ${b.advert.name ?? "advert run"} (${b.starts_on} to ${b.ends_on})`,
    });
    if (!result) return { ok: true, invoice: null };
    if (!result.ok) return { ok: false, error: plain("billing:invoice", result.error) };
    if (opts.hold && result.created && holdsForPayment(b.price_pennies) && b.status === "scheduled" && b.starts_on > today()) {
      const { error: holdError } = await db
        .from("advert_bookings")
        .update({ status: "awaiting_payment", updated_at: now })
        .eq("id", target.advert_booking_id)
        .eq("status", "scheduled");
      if (holdError) return dbFail("billing:hold", holdError, "Invoiced, but it couldn't be held for payment — it may show before it's paid.");
    }
    return { ok: true, invoice: result.invoice };
  }

  const { data: bundle, error } = await db.from("bundles").select("id, member_id, name, price_pennies").eq("id", target.bundle_id).maybeSingle();
  if (error) return dbFail("billing:bundle", error, READ_FAILED);
  if (!bundle) return { ok: false, error: "That bundle no longer exists." };
  if (!bundle.member_id || !bundle.price_pennies) return { ok: true, invoice: null };
  // Nothing booked under it yet (or nothing left running): the first batch of
  // parts invoices it, as it always has.
  const { count, error: partsError } = await db
    .from("advert_bookings")
    .select("id", { count: "exact", head: true })
    .eq("bundle_id", bundle.id)
    .in("status", ["awaiting_payment", "scheduled", "live"]);
  if (partsError) return dbFail("billing:bundle", partsError, READ_FAILED);
  if (!count) return { ok: true, invoice: null };
  const result = await invoiceAdvertising(bundle.member_id, bundle.price_pennies, {
    bundle_id: bundle.id,
    description: `Advertising bundle: ${bundle.name}`,
  });
  if (!result) return { ok: true, invoice: null };
  if (!result.ok) return { ok: false, error: plain("billing:invoice", result.error) };
  if (opts.hold && result.created && holdsForPayment(bundle.price_pennies)) {
    const { error: holdError } = await db
      .from("advert_bookings")
      .update({ status: "awaiting_payment", updated_at: now })
      .eq("bundle_id", bundle.id)
      .eq("status", "scheduled")
      .gt("starts_on", today());
    if (holdError) return dbFail("billing:hold", holdError, "Invoiced, but its parts couldn't be held for payment — they may show before it's paid.");
  }
  return { ok: true, invoice: result.invoice };
}

/**
 * The price came off a held item and its invoice was voided: nothing is owed
 * now, so it schedules as an unpriced booking would.
 */
export async function releaseHold(target: BillTarget): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = serviceDb();
  const now = new Date().toISOString();
  const { error } = "placement_id" in target
    ? await db.from("placements").update({ awaiting_payment: false }).eq("id", target.placement_id)
    : "advert_booking_id" in target
      ? await db.from("advert_bookings").update({ status: "scheduled", updated_at: now }).eq("id", target.advert_booking_id).eq("status", "awaiting_payment")
      // parts priced (and invoiced) on their own keep their own hold
      : await db.from("advert_bookings").update({ status: "scheduled", updated_at: now }).eq("bundle_id", target.bundle_id).eq("status", "awaiting_payment").is("price_pennies", null);
  return error ? dbFail("billing:releaseHold", error, "it couldn't be released just now — save again to retry.") : { ok: true };
}
