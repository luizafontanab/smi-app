import { revalidatePath } from "next/cache";
import { serviceDb } from "./db/server";
import { enqueue, runQueuedJobSoon } from "./jobs";
import { advertPaymentsMode, createInvoiceCheckout, expireCheckoutSession, retrieveCheckoutSession } from "./adapters/advert-checkout";
import { ensureInvoice, linkColumn, type InvoiceLink, type InvoiceResult } from "./invoicing";

/**
 * Online payment for advertising (6 Oct): a priced run is held until it is
 * paid, then released. This module is the one place that decides whether to
 * hold, raises the invoice with its pay link, settles it — whoever does the
 * settling (the Stripe webhook, the pay page's return, Jas marking a bank
 * transfer paid, or the local simulator) — and voids it.
 */

export const formatPounds = (pennies: number) => `£${(pennies / 100).toFixed(2)}`;

const BILLING_PATHS = ["/", "/console", "/console/adverts", "/dashboard", "/dashboard/settings/billing"];

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
 *
 * Idempotent through ensureInvoice(): an item that already has its invoice gets
 * that one back and no second email, so a double-clicked Approve sends one pay
 * link. Returns null when there is nothing to invoice (unpriced), otherwise
 * ensureInvoice()'s result — `ok: false` says why no invoice exists.
 */
export async function invoiceAdvertising(
  memberId: string,
  pennies: number | null | undefined,
  link: InvoiceLink,
): Promise<InvoiceResult | null> {
  if (!pennies || pennies <= 0) return null;
  const result = await ensureInvoice(memberId, pennies, "ADV", link);
  if (result.ok && result.created && holdsForPayment(pennies)) {
    await enqueue("notify_member", {
      member_id: memberId,
      kind: "advert_payment_due",
      invoice_id: result.invoice.id,
      invoice_ref: result.invoice.number,
      amount: formatPounds(pennies),
      ...(link.advert_booking_id ? { booking_id: link.advert_booking_id } : {}),
    });
  }
  return result;
}

export type SettleOptions = {
  /** The Checkout Session that paid, when Stripe did. */
  sessionId?: string;
  /**
   * What Stripe says was paid. Given, the invoice settles only if it matches
   * the invoice's own amount in GBP — otherwise nothing changes and the result
   * is `amount_mismatch`. Omitted for payments Stripe didn't take (Jas's
   * "Mark paid", the simulator).
   */
  paid?: { amountPennies: number | null; currency: string | null };
};

export type SettleResult =
  | { settled: true; memberId: string }
  | {
      settled: false;
      reason: "paid" | "void" | "missing" | "amount_mismatch";
      /** For `paid`: the session that paid it (null when Jas marked it paid by hand). */
      paidSessionId?: string | null;
      memberId?: string;
    };

type SettleRow = {
  outcome: "settled" | "paid" | "void" | "missing" | "amount_mismatch";
  member_id?: string;
  job_id?: string;
  open_session_id?: string | null;
  paid_session_id?: string | null;
};

/**
 * Mark an invoice paid and release everything it was holding.
 *
 * All of it — issued → paid, the held run, bundle or placement released, and
 * the receipt queued — happens in one transaction in settle_invoice()
 * (20261016000003), so a failure part-way can't leave a paid invoice holding a
 * run back. Idempotent: the row lock and the status check are the lock, so a
 * webhook replay, the return page and a double-clicked "Mark paid" can all
 * call this and only the first one does anything.
 *
 * THROWS on a database error. That is the point: "nothing settled" and "the
 * database failed" used to look the same, so the webhook answered 200 to a
 * payment it had not recorded and Stripe never retried. Callers that can't
 * retry (a console button) catch it and say so.
 *
 * `settled: false` carries the reason: already `paid` (and by which session),
 * `void` (its hold lapsed or the run was called off — not payable), `missing`,
 * or `amount_mismatch` when `opts.paid` disagrees with the invoice.
 */
export async function settleInvoice(invoiceId: string, opts: SettleOptions = {}): Promise<SettleResult> {
  const { data, error } = await serviceDb().rpc("settle_invoice", {
    p_invoice_id: invoiceId,
    ...(opts.sessionId ? { p_session_id: opts.sessionId } : {}),
    ...(opts.paid
      ? { p_paid_amount: opts.paid.amountPennies ?? -1, p_paid_currency: opts.paid.currency ?? "" }
      : {}),
  });
  if (error) throw new Error(`settleInvoice ${invoiceId}: ${error.message}`);
  const row = data as SettleRow | null;
  if (!row?.outcome) throw new Error(`settleInvoice ${invoiceId}: settle_invoice returned nothing`);

  if (row.outcome !== "settled") {
    return {
      settled: false,
      reason: row.outcome,
      ...(row.outcome === "paid" ? { paidSessionId: row.paid_session_id ?? null } : {}),
      ...(row.member_id ? { memberId: row.member_id } : {}),
    };
  }

  if (row.job_id) runQueuedJobSoon(row.job_id);
  // A second session left open for this invoice (two tabs from before
  // sessions were reused) must not take the money again.
  if (row.open_session_id && row.open_session_id !== opts.sessionId) {
    const expired = await expireCheckoutSession(row.open_session_id);
    if (!expired.ok && expired.status === "open") console.error(`[settle] ${invoiceId} is paid but its other session ${row.open_session_id} is still open: ${expired.error}`);
  }
  for (const path of BILLING_PATHS) revalidatePath(path);
  return { settled: true, memberId: row.member_id! };
}

export type InvoiceTarget = { advert_booking_id?: string | null; bundle_id?: string | null; placement_id?: string | null };

export type VoidResult =
  | {
      ok: true;
      /** Invoices this call voided. */
      voided: string[];
      /**
       * Invoices left issued because their Checkout Session had already
       * completed — the member paid while this ran. The webhook settles them;
       * whoever called this needs to know the item is being paid for.
       */
      paying: string[];
    }
  | { ok: false; error: string };

/**
 * Void the issued invoice(s) for ONE booking, bundle or placement, expiring
 * any Checkout Session open on them first, so a pay page left open in a tab
 * stops taking money the moment the invoice is cancelled.
 *
 * Expire-then-void, never the other way round: if Stripe says the session has
 * already completed, the member has paid (or a bank debit is under way), and
 * voiding under them is exactly how money gets taken for nothing. Those are
 * left issued and reported in `paying`.
 *
 * Pass exactly one id: `voidInvoices({ advert_booking_id })`,
 * `voidInvoices({ bundle_id })` or `voidInvoices({ placement_id })`. A
 * booking inside a bundle is paid through the bundle's invoice — use
 * voidBundleInvoiceIfAbandoned() for that.
 */
export async function voidInvoices(link: InvoiceTarget): Promise<VoidResult> {
  const target = linkColumn({
    advert_booking_id: link.advert_booking_id ?? undefined,
    bundle_id: link.bundle_id ?? undefined,
    placement_id: link.placement_id ?? undefined,
  });
  if (!target) return { ok: false, error: "voidInvoices needs exactly one of advert_booking_id, bundle_id or placement_id." };

  const db = serviceDb();
  const { data: open, error } = await db
    .from("invoices")
    .select("id, checkout_session_id")
    .eq(target.column, target.id)
    .eq("status", "issued");
  if (error) return { ok: false, error: `Could not read the invoices to void: ${error.message}` };

  const voided: string[] = [];
  const paying: string[] = [];
  for (const invoice of open ?? []) {
    if (invoice.checkout_session_id) {
      const expired = await expireCheckoutSession(invoice.checkout_session_id);
      if (!expired.ok && expired.status === "complete") {
        paying.push(invoice.id);
        continue;
      }
      // Anything else — already expired, or Stripe unreachable — still voids:
      // the session dies within the hour on its own, and if it is paid in that
      // window the webhook finds a void invoice and raises the alarm.
      if (!expired.ok && expired.status !== "expired") console.error(`[void] ${invoice.id}: ${expired.error}`);
    }
    const { data: done, error: voidError } = await db
      .from("invoices")
      .update({ status: "void", checkout_session_id: null, checkout_expires_at: null })
      .eq("id", invoice.id)
      .eq("status", "issued")
      .select("id");
    if (voidError) return { ok: false, error: `Could not void invoice ${invoice.id}: ${voidError.message}` };
    if (done?.length) voided.push(invoice.id);
  }
  if (voided.length) for (const path of BILLING_PATHS) revalidatePath(path);
  return { ok: true, voided, paying };
}

/**
 * A bundle has one invoice for all of its parts, so ending a part can't void
 * it — only the last one can. This voids the bundle's issued invoice once
 * nothing in the bundle is still awaiting payment, scheduled or live: every
 * part has ended (called off, lapsed unpaid) or never got past approval.
 *
 * Safe to call after any change to a bundle's parts; it does nothing while
 * any part is still owed for. `voided: false` with `ok: true` means the
 * bundle is still in use.
 */
export async function voidBundleInvoiceIfAbandoned(bundleId: string): Promise<{ ok: true; voided: boolean; paying: boolean } | { ok: false; error: string }> {
  const { count, error } = await serviceDb()
    .from("advert_bookings")
    .select("id", { count: "exact", head: true })
    .eq("bundle_id", bundleId)
    .in("status", ["awaiting_payment", "scheduled", "live"]);
  if (error) return { ok: false, error: `Could not read the bundle's runs: ${error.message}` };
  if (count) return { ok: true, voided: false, paying: false };
  const result = await voidInvoices({ bundle_id: bundleId });
  if (!result.ok) return result;
  return { ok: true, voided: result.voided.length > 0, paying: result.paying.length > 0 };
}

type PayableInvoice = { id: string; number: string; amount_pennies: number; description: string | null; checkout_session_id: string | null; checkout_expires_at: string | null };

/** Sessions with less than this left are replaced rather than handed out: the member needs time to type a card. */
const MIN_SESSION_LIFE_MS = 5 * 60_000;

/**
 * The client secret for an invoice's embedded Checkout — the session already
 * open for it while there is one, a new one only when there isn't.
 *
 * Every pay-page mount used to create a session, so two tabs were two payable
 * sessions for one invoice. Now the open session is remembered on the invoice
 * (20261016000002) and the store is a compare-and-swap on the session it
 * replaces: when two tabs race, one wins, the loser's session is expired at
 * Stripe and the loser is handed the winner's — so at most one session per
 * invoice is ever payable.
 */
export async function invoiceCheckoutSecret(
  invoice: PayableInvoice,
  member: { memberId: string; email: string | null },
  returnUrl: string,
): Promise<{ ok: true; clientSecret: string } | { ok: false; error: string; alreadyPaid?: boolean }> {
  const db = serviceDb();
  const current = invoice.checkout_session_id;

  const reuse = async (sessionId: string, expiresAt: string | null) => {
    if (expiresAt && Date.parse(expiresAt) - Date.now() < MIN_SESSION_LIFE_MS) return null;
    const session = await retrieveCheckoutSession(sessionId);
    if (!session) return null;
    if (session.status === "complete") return { ok: false as const, error: "This invoice has just been paid — refresh the page.", alreadyPaid: true };
    if (session.status === "open" && session.clientSecret && session.invoiceId === invoice.id) return { ok: true as const, clientSecret: session.clientSecret };
    // Open but unusable (no secret came back): end it, so replacing it can't
    // leave two payable.
    if (session.status === "open") await expireCheckoutSession(sessionId);
    return null;
  };

  if (current) {
    const reused = await reuse(current, invoice.checkout_expires_at);
    if (reused) return reused;
    // Too close to expiry to hand out: end it before opening the next one.
    if (invoice.checkout_expires_at && Date.parse(invoice.checkout_expires_at) - Date.now() < MIN_SESSION_LIFE_MS) {
      await expireCheckoutSession(current);
    }
  }

  const created = await createInvoiceCheckout({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    memberId: member.memberId,
    email: member.email,
    description: invoice.description ?? `Sheet Metal Industries — ${invoice.number}`,
    amountPennies: invoice.amount_pennies,
    returnUrl,
    replacesSessionId: current,
  });
  if (!created.ok) return created;

  let swap = db
    .from("invoices")
    .update({ checkout_session_id: created.sessionId, checkout_expires_at: created.expiresAt })
    .eq("id", invoice.id)
    .eq("status", "issued");
  swap = current ? swap.eq("checkout_session_id", current) : swap.is("checkout_session_id", null);
  const { data: stored, error } = await swap.select("id");
  if (error) {
    // Not stored means nobody else can find this session again — end it
    // rather than leave a payable session the invoice doesn't know about.
    await expireCheckoutSession(created.sessionId);
    return { ok: false, error: `Could not record the checkout session: ${error.message}` };
  }
  if (stored?.length) return { ok: true, clientSecret: created.clientSecret };

  // Lost the race (or the invoice stopped being payable meanwhile).
  const { data: now } = await db
    .from("invoices")
    .select("status, checkout_session_id, checkout_expires_at")
    .eq("id", invoice.id)
    .maybeSingle();
  if (now?.checkout_session_id === created.sessionId) return { ok: true, clientSecret: created.clientSecret };
  await expireCheckoutSession(created.sessionId);
  if (now?.status !== "issued") return { ok: false, error: "This invoice can't be paid — it may already be paid.", alreadyPaid: now?.status === "paid" };
  if (now.checkout_session_id) {
    const reused = await reuse(now.checkout_session_id, now.checkout_expires_at);
    if (reused) return reused;
  }
  return { ok: false, error: "The payment form was opened somewhere else at the same moment — please try again." };
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
