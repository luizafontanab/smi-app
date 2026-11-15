/**
 * One payable membership checkout per member (#5, formerly GAPS B1.8;
 * docs/adr/0003-one-payable-membership-checkout-per-member.md).
 *
 * Every "Pay £40/month" used to open a new embedded Checkout Session, and the
 * Idempotency-Key only merged presses within the same minute, so two tabs a
 * minute apart were two payable sessions and could become two subscriptions.
 * Now the open session is remembered on the member (20261115000001) and
 * handed back while it's usable, following invoiceCheckoutSecret
 * (src/lib/advert-payments.ts):
 *
 *   · an open session with enough life left is reused; nothing is created;
 *   · a `complete` one means the member has paid; the caller records it;
 *   · an unusable or nearly expired one is expired at Stripe before its
 *     replacement is created;
 *   · the replacement is stored with a compare-and-swap on the session it
 *     replaces. When two tabs race, one wins, the loser's new session is
 *     expired and the loser gets the winner's.
 *
 * The race prevention can't close (two payments finishing together) is
 * caught in recordMembershipCheckout (src/lib/membership.ts).
 *
 * Stripe calls stay in the adapters: creation through `Payments`, reading and
 * expiring through advert-checkout.ts's session helpers.
 */

import { serviceDb } from "./db/server";
import { logError } from "./log";
import { MEMBERSHIP_CHECKOUT_KIND, type CheckoutRequest, type CheckoutResult, type Payments } from "./adapters/payments";
import { expireCheckoutSession, retrieveCheckoutSession, type CheckoutSessionState } from "./adapters/advert-checkout";

/** The member columns that remember the open membership checkout. */
export type StoredMembershipCheckout = {
  id: string;
  membership_checkout_session_id: string | null;
  membership_checkout_expires_at: string | null;
};

/**
 * The stored checkout has already been completed: the member paid in another
 * tab. `paid` is false while Stripe is still settling the payment.
 */
export type MembershipCheckoutComplete = {
  kind: "complete";
  sessionId: string;
  paid: boolean;
  subscriptionId: string | null;
  customerId: string | null;
};

/** Sessions with less than this left are replaced rather than handed out: the member needs time to type a card. */
const MIN_SESSION_LIFE_MS = 5 * 60_000;

const nearlyExpired = (expiresAt: string | null) =>
  Boolean(expiresAt) && Date.parse(expiresAt!) - Date.now() < MIN_SESSION_LIFE_MS;

const completed = (sessionId: string, s: CheckoutSessionState): MembershipCheckoutComplete => ({
  kind: "complete",
  sessionId,
  paid: s.paymentStatus === "paid",
  subscriptionId: s.subscriptionId,
  customerId: s.customerId,
});

/**
 * The card checkout for a member's £40/month: the stored session while it's
 * usable, otherwise a new one, stored. Results other than `embedded` from the
 * adapter (the hosted redirect on Preview mocks, the local stub's `paid`, an
 * error) pass straight through and nothing is stored.
 */
export async function openMembershipCheckout(
  member: StoredMembershipCheckout,
  req: Omit<CheckoutRequest, "promoCode" | "replacesSessionId">,
  payments: Payments,
): Promise<CheckoutResult | MembershipCheckoutComplete> {
  const db = serviceDb();
  const current = member.membership_checkout_session_id;

  // The stored session handed back, reported as paid, or null when it has to be replaced.
  const reuse = async (sessionId: string, expiresAt: string | null) => {
    const session = await retrieveCheckoutSession(sessionId);
    if (!session || session.kind !== MEMBERSHIP_CHECKOUT_KIND || session.clientReferenceId !== member.id) return null;
    if (session.status === "complete") return completed(sessionId, session);
    if (session.status === "open" && session.clientSecret && expiresAt && !nearlyExpired(expiresAt)) {
      return { kind: "embedded" as const, clientSecret: session.clientSecret, sessionId, expiresAt };
    }
    return null;
  };

  if (current) {
    const reused = await reuse(current, member.membership_checkout_expires_at);
    if (reused) return reused;
    // Unusable or nearly expired: end it before opening the next, so
    // replacing it can't leave two payable.
    const ended = await expireCheckoutSession(current);
    if (!ended.ok && ended.status === "complete") {
      const session = await retrieveCheckoutSession(current);
      if (session) return completed(current, session);
    }
    if (!ended.ok && ended.status === "open") {
      return { kind: "error", message: "Could not reopen your payment form — please try again in a moment." };
    }
  }

  const created = await payments.createCheckout({ ...req, replacesSessionId: current });
  if (created.kind !== "embedded") return created;

  let swap = db
    .from("members")
    .update({ membership_checkout_session_id: created.sessionId, membership_checkout_expires_at: created.expiresAt })
    .eq("id", member.id);
  swap = current ? swap.eq("membership_checkout_session_id", current) : swap.is("membership_checkout_session_id", null);
  const { data: stored, error } = await swap.select("id");
  if (error) {
    // Not stored means no later request can find this session — end it
    // rather than leave a payable session the member row doesn't know about.
    await expireCheckoutSession(created.sessionId);
    return { kind: "error", message: `Could not record the checkout session: ${error.message}` };
  }
  if (stored?.length) return created;

  // Lost the race: another request replaced the same state first.
  const { data: now } = await db
    .from("members")
    .select("membership_checkout_session_id, membership_checkout_expires_at")
    .eq("id", member.id)
    .maybeSingle();
  // Both requests sent the same Idempotency-Key and got the same session back.
  if (now?.membership_checkout_session_id === created.sessionId) return created;
  await expireCheckoutSession(created.sessionId);
  if (now?.membership_checkout_session_id) {
    const reused = await reuse(now.membership_checkout_session_id, now.membership_checkout_expires_at);
    if (reused) return reused;
  }
  return { kind: "error", message: "The payment form was opened somewhere else at the same moment — please try again." };
}

/**
 * Redeeming a promo code ends the member's open card checkout (ADR 0003), so
 * a member on a free promo can't also start a paid subscription from a
 * leftover tab. Never throws: the comp has already been granted.
 */
export async function cancelOpenMembershipCheckout(member: StoredMembershipCheckout): Promise<void> {
  const current = member.membership_checkout_session_id;
  if (!current) return;
  const ended = await expireCheckoutSession(current);
  if (!ended.ok && (ended.status === "open" || ended.status === "complete")) {
    // Still payable, or paid meanwhile (the webhook records that). Either
    // way keep it on the member, so a later checkout still finds it.
    logError({
      source: "adapter",
      area: "membership-checkout:promo-cancel",
      error: new Error(ended.error),
      context: { member_id: member.id, session_status: ended.status },
    });
    return;
  }
  await serviceDb()
    .from("members")
    .update({ membership_checkout_session_id: null, membership_checkout_expires_at: null })
    .eq("id", member.id)
    .eq("membership_checkout_session_id", current);
}
