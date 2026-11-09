import { serviceDb } from "./db/server";
import { logError } from "./log";
import { replaceMemberMembershipTypes } from "./member-services";
import { notifyConsole } from "./notify-admin";
import { invoiceNumber } from "./invoicing";
import { websiteUrl } from "./website-url";
import { graceUntilFrom } from "./grace-period";
import type { CheckoutResult } from "./adapters/payments";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export type ProvisionResult = { memberId: string } | { error: string };

export type MemberStatus = "draft" | "active" | "grace" | "lapsed";

export const MEMBER_STATUSES: readonly MemberStatus[] = ["draft", "active", "grace", "lapsed"];
export const BILLING_MODES: readonly string[] = ["card", "invoice"];

/**
 * Member-facing wording for a status. "grace" and "lapsed" are internal terms —
 * a member reading their own page should get the plain-English version, and the
 * grace banner in the dashboard layout already explains the detail.
 */
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  draft: "Awaiting activation",
  active: "Active",
  grace: "Payment overdue",
  lapsed: "Lapsed",
};

/**
 * V13 step 4 (A17) — a draft member only goes live once a payment or comp is on
 * record. Both the list-page Activate button and the console edit form POST
 * directly, so this is a guard, not a UI nicety: it is evaluated against the
 * values about to be written, which lets "mark paid and activate" happen in one
 * save while still refusing a bare activation.
 *
 * Returns the message to show, or null when the transition is allowed.
 */
export function activationBlocked(
  current: { status: MemberStatus },
  next: { status: MemberStatus; paid_at: string | null; comped_until: string | null },
): string | null {
  if (current.status !== "draft" || next.status !== "active") return null;
  if (next.paid_at || next.comped_until) return null;
  return "Activating a draft member needs a payment or comp on record — use “Record payment” or set a comped-until date first.";
}

/**
 * V13 step 1 — account + draft company page (payment comes after, approval last).
 * Kept out of the server action so it's testable without request context.
 */
export async function provisionMember(opts: {
  email: string;
  password: string;
  company: string;
  phone?: string;
  website?: string;
  address?: string;
  membershipTypeIds?: number[];
}): Promise<ProvisionResult> {
  const db = serviceDb();
  const { data: user, error: authErr } = await db.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
  });
  if (authErr) {
    return {
      error: authErr.message.includes("already")
        ? "An account with this email already exists — try logging in."
        : authErr.message,
    };
  }

  const website = websiteUrl(opts.website);
  const { data: member, error: memberErr } = await db.from("members").insert({
    slug: `${slugify(opts.company)}-${Date.now().toString(36)}`,
    name: opts.company,
    status: "draft",
    billing_mode: "card",
    contact_email: opts.email,
    joined_at: new Date().toISOString().slice(0, 10),
    // what /join step 3 promises to "auto-fill" — only what was actually
    // collected at step 1, everything else stays blank for the member to add
    ...(opts.phone ? { phone: opts.phone } : {}),
    // Stored as an absolute link, like every other save path (website-url.ts):
    // "www.foo.co.uk" typed at signup used to become a relative href.
    ...(website ? { website } : {}),
    ...(opts.address ? { address: opts.address } : {}),
  }).select("id").single();
  if (memberErr || !member) {
    await db.auth.admin.deleteUser(user.user.id); // don't leave a half-created account
    return { error: "Could not create your company page — please try again." };
  }
  await db.from("profiles").insert({ user_id: user.user.id, role: "member", member_id: member.id, display_name: opts.company });
  await db.from("notification_prefs").insert({ member_id: member.id });
  // Picked at step 1 (GAPS A8.1). A failure here must not undo a signup that
  // has already created the account: the types are editable on the company
  // page the member is about to build, so log it and carry on.
  if (opts.membershipTypeIds?.length) {
    try {
      await replaceMemberMembershipTypes(db, member.id, opts.membershipTypeIds);
    } catch (e) {
      logError({ source: "db", area: "join:membership-types", error: e, context: { member_id: member.id } });
    }
  }
  return { memberId: member.id };
}

/**
 * Queue a member notification without ever failing the caller.
 *
 * Every caller here has already committed the thing that matters — the payment
 * is recorded, the comp is applied — so a queue hiccup must not surface as a
 * failed payment to someone whose money has moved.
 */
async function notifyQuietly(memberId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const { enqueue } = await import("./jobs");
    await enqueue("notify_member", { member_id: memberId, ...payload });
  } catch (e) {
    logError({ source: "server", area: "membership:queue-notification", error: e, context: { member_id: memberId } });
  }
}

/**
 * V13 step 2 — persist what checkout settled: card payment (+ invoice the
 * member can see under Billing) or comped months from a promo code.
 * `/api/stripe/webhook` calls this too — keep it the single seam.
 *
 * `opts.sessionId` is the Stripe Checkout Session the payment came through, and
 * makes this idempotent per session: the invoice row is claimed FIRST, on the
 * unique invoices_stripe_session_idx (20261006000002), and a conflict means a
 * retry of an event already recorded — so nothing else (paid_at, PDF, receipt)
 * is repeated. Stripe retries any webhook it doesn't see a 2xx for, and a
 * timeout after this had run used to raise a second SMI-JOIN invoice and mail
 * a second receipt. Callers without a session (the stubbed checkout in dev)
 * work exactly as before.
 *
 * With a session this throws when the payment can't be recorded, so the
 * webhook answers 500 and Stripe tries again.
 *
 * Returns true when this call recorded something, false when there was nothing
 * to do — a retry of a session already recorded, or a result that settles
 * nothing (redirect, embedded, error) — so a caller can announce a payment once.
 */
export async function applyPaymentResult(memberId: string, result: CheckoutResult, opts: { sessionId?: string } = {}): Promise<boolean> {
  const db = serviceDb();
  if (result.kind === "paid") {
    const now = new Date();
    const number = invoiceNumber("JOIN", now);
    const issuedOn = now.toISOString().slice(0, 10);

    let claimedId: string | null = null;
    if (opts.sessionId) {
      const { data: claimed, error } = await db.from("invoices").insert({
        member_id: memberId,
        number,
        amount_pennies: 4000,
        issued_on: issuedOn,
        status: "paid",
        paid_at: now.toISOString(),
        stripe_session_id: opts.sessionId,
      }).select("id").single();
      if (error?.code === "23505" && error.message.includes("invoices_stripe_session_idx")) return false; // already recorded
      if (error || !claimed) throw new Error(`applyPaymentResult: ${opts.sessionId} for member ${memberId} was not recorded: ${error?.message ?? "no row returned"}`);
      claimedId = claimed.id;
      const { error: memberErr } = await db.from("members").update({ paid_at: now.toISOString() }).eq("id", memberId);
      if (memberErr) {
        // Release the claim, or the retry this throw asks for would find it
        // and skip — leaving the member unpaid for good.
        await db.from("invoices").delete().eq("id", claimedId);
        throw new Error(`applyPaymentResult: paid_at not stamped for member ${memberId}: ${memberErr.message}`);
      }
    } else {
      await db.from("members").update({ paid_at: now.toISOString() }).eq("id", memberId);
    }

    const { data: member } = await db.from("members").select("name").eq("id", memberId).single();
    const { generateAndStoreInvoicePdf } = await import("./invoice-pdf");
    const pdfPath = await generateAndStoreInvoicePdf(memberId, {
      number, amountPennies: 4000, issuedOn, memberName: member?.name ?? "Member",
    });
    if (claimedId) {
      if (pdfPath) await db.from("invoices").update({ pdf_path: pdfPath }).eq("id", claimedId);
    } else {
      await db.from("invoices").insert({
        member_id: memberId,
        number,
        amount_pennies: 4000,
        issued_on: issuedOn,
        status: "paid",
        ...(pdfPath ? { pdf_path: pdfPath } : {}),
      });
    }
    // Gated, not unconditional: while payments are stubbed a "paid" result means
    // nothing was charged (GAPS C1), and a receipt for money that never moved is
    // a false record in a member's inbox. Flips on with the Stripe adapter — and
    // because the webhook route will call this same seam, it works there too.
    const { paymentsAreLive } = await import("./adapters/payments");
    if (paymentsAreLive()) {
      await notifyQuietly(memberId, { kind: "payment_receipt", amount: "£40.00", invoice_ref: number });
    }
    return true;
  } else if (result.kind === "comped") {
    // date-only arithmetic: UTC noon dodges TZ off-by-one at month boundaries
    const d = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + result.months);
    const until = d.toISOString().slice(0, 10);
    await db.from("members").update({ comped_until: until }).eq("id", memberId);
    // A comp is real whether or not Stripe exists, so this one always sends.
    await notifyQuietly(memberId, { kind: "comp_applied", months: result.months, comped_until: until });
    return true;
  }
  return false;
}

/**
 * A completed Stripe membership Checkout Session, recorded once (GAPS B1.7).
 * Both the webhook and the pay page's return fast path call this; whichever
 * runs first records it, and the other finds the session already claimed.
 *
 * Also remembers the subscription and customer (B1.5) so a later cancel has
 * something of ours to act on, and tells Jas a payment came in. That console
 * note used to be sent only by the simulated and promo paths, so a real card
 * payment arrived in silence; it goes only when this call did the recording,
 * so a Stripe retry can't send it twice.
 */
export async function recordMembershipCheckout(
  memberId: string,
  checkout: { sessionId: string | null; subscriptionId?: string | null; customerId?: string | null },
): Promise<boolean> {
  const sessionId = checkout.sessionId?.startsWith("cs_") ? checkout.sessionId : undefined;
  const recorded = await applyPaymentResult(memberId, { kind: "paid" }, sessionId ? { sessionId } : {});
  const { subscriptionId, customerId } = checkout;
  if (subscriptionId || customerId) {
    await serviceDb().from("members").update({
      ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    }).eq("id", memberId);
  }
  if (recorded) {
    await notifyConsole({
      kind: "payment_taken",
      memberId,
      payload: { member_id: memberId },
      message: "Paid £40/month by card. Next step: build their page.",
    });
  }
  return recorded;
}

/**
 * A Stripe `invoice.payment_failed` (recurring card decline, not the initial
 * checkout) moves the member straight to grace — the same state and
 * `GRACE_PERIOD_DAYS` window `jobs.ts`'s `comp_expiry` case already uses for an
 * expired promo comp, so "Needs You Today" and the lapse job (A4.3) treat both
 * the same way without knowing which path put a member into grace.
 */
export async function applyPaymentFailure(memberId: string): Promise<void> {
  const db = serviceDb();
  // contact_email was selected only to stamp it onto the inbox row; a
  // notification has no correspondent, so it is no longer read here.
  const { data: member } = await db.from("members").select("name").eq("id", memberId).single();
  if (!member) return;

  const until = graceUntilFrom(new Date().toISOString().slice(0, 10));

  await db.from("members").update({ status: "grace", grace_until: until }).eq("id", memberId);
  // A notification, not an enquiry (fix-list 71). It used to be written as a
  // `kind: 'membership'` row carrying the member's contact address, which made
  // it indistinguishable from a member asking a question — and offered a reply
  // form for a message nobody had sent.
  await notifyConsole({
    kind: "payment_failed",
    memberId,
    name: member.name,
    payload: { member_id: memberId },
    message: `Card payment failed — moved to grace until ${until}.`,
  });
}

/**
 * Why a change to a membership's renewal — a cancel (#90) or its undo (#92) — did
 * not happen. The module states the reason only; wording is the caller's
 * (the console's admin wording lives in `app/console/membership-messages.ts`).
 *
 * - `not_found`: no such member.
 * - `no_subscription`: payments are live and there is no subscription id this
 *   site stored itself, so there is nothing it may act on (B1.6).
 * - `period_ended`: the paid period is already over — the member has lapsed
 *   here, or Stripe has already closed the subscription.
 * - `stripe_rejected`: Stripe refused; `detail` is Stripe's own message.
 */
export type MembershipChangeFailure =
  | { ok: false; reason: "not_found" | "no_subscription" | "period_ended" }
  | { ok: false; reason: "stripe_rejected"; detail: string };

/**
 * The result of a cancel and of its undo (#92). `changed` is false when the
 * membership was already in the asked-for state, so a repeat is harmless and a
 * caller can skip its audit row.
 */
export type MembershipChangeResult = { ok: true; changed: boolean } | MembershipChangeFailure;

/**
 * What the console's Cancel membership section offers a member (#90):
 * - `none`: draft or lapsed — no section at all.
 * - `invoice`: invoice billing has no card subscription to stop; the admin
 *   stops raising invoices by hand.
 * - `pending`: a card member whose cancel is scheduled; Undo is offered (#92).
 * - `cancellable`: a card member, active or in grace, with no cancel pending.
 * The page renders from it and the console action refuses anything else, so
 * the two can't disagree.
 */
export type MembershipCancelState = "none" | "invoice" | "pending" | "cancellable";

export function membershipCancelState(member: {
  status: string; billing_mode: string; cancel_requested_at: string | null;
}): MembershipCancelState {
  if (member.status !== "active" && member.status !== "grace") return "none";
  if (member.billing_mode === "invoice") return "invoice";
  return member.cancel_requested_at ? "pending" : "cancellable";
}

/**
 * Cancel a membership (GLOSSARY "Cancel a membership"; GAPS B1.5, #90): stop
 * renewal at the end of the paid period on Stripe's side (if live), stamp the
 * pending cancel, and queue the "cancellation scheduled" email. The membership
 * itself doesn't end here — `applySubscriptionEnded` does that when Stripe's
 * own `customer.subscription.deleted` webhook confirms the period is over, the
 * same "webhook completes the transition" shape as `applyPaymentFailure`/grace.
 *
 * Stamps once: a repeat finds the cancel pending and changes nothing.
 */
export async function requestCancellation(memberId: string): Promise<MembershipChangeResult> {
  const db = serviceDb();
  const { data: member } = await db
    .from("members")
    .select("status, stripe_subscription_id, cancel_requested_at")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) return { ok: false, reason: "not_found" };
  if (member.cancel_requested_at) return { ok: true, changed: false }; // already pending — idempotent
  if (member.status === "lapsed") return { ok: false, reason: "period_ended" };

  const { paymentsAreLive, getPayments } = await import("./adapters/payments");
  if (paymentsAreLive()) {
    // B1.6: only ever act on the subscription id this app itself wrote —
    // never derive or guess one another way.
    if (!member.stripe_subscription_id) return { ok: false, reason: "no_subscription" };
    const result = await getPayments().cancelSubscription(member.stripe_subscription_id);
    if (!result.ok) {
      return result.reason === "period_ended"
        ? { ok: false, reason: "period_ended" }
        : { ok: false, reason: "stripe_rejected", detail: result.error };
    }
  }

  // Only where still unstamped: two cancels racing past the read above must
  // not both stamp and both email.
  const { data: stamped } = await db.from("members")
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", memberId).is("cancel_requested_at", null)
    .select("id");
  if (!stamped?.length) return { ok: true, changed: false };
  await notifyQuietly(memberId, { kind: "membership_cancel_requested" });
  return { ok: true, changed: true };
}

/**
 * Undo a cancellation (#92) — the reverse of `requestCancellation`, for a
 * member who changed their mind: tell Stripe (if live) to keep renewing the
 * stored subscription, clear the pending cancel, and queue the "membership
 * will continue" email. Same result type and the same B1.6 rule as cancel.
 *
 * If Stripe has already closed the subscription the result is `period_ended`
 * and the row is left as it is — the member must rejoin. With no cancel
 * pending it changes nothing (`changed: false`), so a repeat is harmless.
 */
export async function undoCancellation(memberId: string): Promise<MembershipChangeResult> {
  const db = serviceDb();
  const { data: member } = await db
    .from("members")
    .select("status, stripe_subscription_id, cancel_requested_at")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) return { ok: false, reason: "not_found" };
  if (!member.cancel_requested_at) return { ok: true, changed: false }; // nothing pending — idempotent
  if (member.status === "lapsed") return { ok: false, reason: "period_ended" };

  const { paymentsAreLive, getPayments } = await import("./adapters/payments");
  if (paymentsAreLive()) {
    if (!member.stripe_subscription_id) return { ok: false, reason: "no_subscription" };
    const result = await getPayments().keepRenewing(member.stripe_subscription_id);
    if (!result.ok) {
      return result.reason === "period_ended"
        ? { ok: false, reason: "period_ended" }
        : { ok: false, reason: "stripe_rejected", detail: result.error };
    }
  }

  // Only where still stamped: two undos racing past the read above must not
  // both clear and both email.
  const { data: cleared } = await db.from("members")
    .update({ cancel_requested_at: null })
    .eq("id", memberId).not("cancel_requested_at", "is", null)
    .select("id");
  if (!cleared?.length) return { ok: true, changed: false };
  await notifyQuietly(memberId, { kind: "membership_cancel_undone" });
  return { ok: true, changed: true };
}

/**
 * Stripe's `customer.subscription.deleted` — the period actually ended.
 * Mirrors `applyPaymentFailure`'s shape: local state update, a member
 * notification, and a console notification so it surfaces there the same way.
 */
export async function applySubscriptionEnded(memberId: string): Promise<void> {
  const db = serviceDb();
  const { data: member } = await db.from("members").select("name").eq("id", memberId).single();
  if (!member) return;

  await db.from("members").update({ status: "lapsed", cancel_requested_at: null }).eq("id", memberId);
  await notifyConsole({
    kind: "subscription_ended",
    memberId,
    name: member.name,
    payload: { member_id: memberId },
    message: "Subscription cancelled and membership ended.",
  });
  await notifyQuietly(memberId, { kind: "membership_cancelled" });
}
