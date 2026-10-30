import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applyPaymentFailure, applySubscriptionEnded, recordMembershipCheckout } from "@/lib/membership";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";
import { ADVERT_INVOICE_KIND } from "@/lib/adapters/advert-checkout";
import { formatPounds, settleInvoice } from "@/lib/advert-payments";
import { logError } from "@/lib/log";
import { notifyConsole } from "@/lib/notify-admin";

/**
 * Stripe events → membership state (GAPS B1.3/B1.4).
 *
 * Hand-rolled signature verification rather than the `stripe` package, matching
 * every other adapter in this repo (no vendor SDKs). Stripe's scheme: the
 * `Stripe-Signature` header carries `t=<unix ts>,v1=<hex hmac>[,v0=...]`; the
 * signed payload is `${t}.${rawBody}`, keyed with the webhook signing secret.
 *
 * The header can carry SEVERAL v1 signatures: while a signing secret is being
 * rolled, Stripe signs with the old and the new one for up to 24 hours. Any
 * one matching is enough — keeping only the last one, as this used to, would
 * reject every event signed first with the secret this deployment still has.
 */

const TOLERANCE_MS = 5 * 60_000;

function verify(secret: string, header: string | null, body: string): boolean {
  if (!header) return false;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const kv of header.split(",")) {
    const at = kv.indexOf("=");
    if (at < 0) continue;
    const key = kv.slice(0, at).trim();
    const value = kv.slice(at + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !signatures.length) return false;

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > TOLERANCE_MS) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"), "hex");
  // Every candidate is compared, match or not, so how long this takes says
  // nothing about which one (if any) matched.
  let ok = false;
  for (const signature of signatures) {
    const candidate = Buffer.from(signature, "hex");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) ok = true;
  }
  return ok;
}

type StripeEvent = {
  type?: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string;
      payment_status?: string;
      amount_total?: number | null;
      currency?: string | null;
      metadata?: { member_id?: string; kind?: string; invoice_id?: string };
      subscription?: string;
      customer?: string;
      parent?: { subscription_details?: { subscription?: string } };
    };
  };
};

/**
 * `checkout.session.completed` carries `client_reference_id` directly, but a
 * later `invoice.payment_failed` carries the Subscription, not the Checkout
 * Session — so the member reference has to be read back off the subscription
 * metadata `createCheckout` copied it onto (`payments.ts`'s
 * `subscription_data[metadata][member_id]`). ⚠ Written against Stripe's
 * documented API but never run against a live account — the invoice's exact
 * subscription-reference field moved between API versions (`subscription` vs
 * `parent.subscription_details.subscription`); confirm on the first real
 * failed payment.
 */
async function memberIdFromSubscription(subscriptionId: string): Promise<string | null> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return null;
  const base = mockBaseUrl() ?? "https://api.stripe.com";
  const res = await fetch(`${base}/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) return null;
  const sub = (await res.json().catch(() => null)) as { metadata?: { member_id?: string } } | null;
  return sub?.metadata?.member_id ?? null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Fails closed, like /api/webhooks/resend and /api/cron: an unauthenticated
    // endpoint that flips membership state is worse than one that is off.
    console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const body = await request.text();
  if (!verify(secret, request.headers.get("stripe-signature"), body)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  // Advert invoices (6 Oct) first, and they never fall through. An advert
  // Checkout Session also carries client_reference_id = the member, so
  // without this branch the membership path below would read an advert
  // payment as the £40 join fee — stamping paid_at and raising a second,
  // membership invoice for money that was for an advert.
  const object = event.data?.object;
  if (object?.metadata?.kind === ADVERT_INVOICE_KIND) {
    const invoiceId = object.metadata.invoice_id;
    // A card settles inside checkout.session.completed; a delayed method
    // (bank debit) completes the session unpaid and settles later. Anything
    // else for an advert session — async_payment_failed, expired — settles
    // nothing and is acknowledged: the invoice stays issued and payable.
    const paid =
      (event.type === "checkout.session.completed" && object.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded";
    if (!invoiceId || !paid) return NextResponse.json({ ok: true, advert_invoice: invoiceId ?? null, settled: false });

    // A database error throws out of settleInvoice() and this route answers
    // 500, so Stripe retries — the alternative, a 200 for a payment nobody
    // recorded, is how a paid run used to end up voided as 'unpaid'.
    let result;
    try {
      result = await settleInvoice(invoiceId, {
        sessionId: object.id,
        // Defence in depth: the session's amount came from the invoice row,
        // but a payment that doesn't match it must never release the run.
        paid: { amountPennies: object.amount_total ?? null, currency: object.currency ?? null },
      });
    } catch (e) {
      logError({ source: "webhook", area: "stripe-webhook:advert-settle", error: e, context: { invoice_id: invoiceId, session_id: object.id ?? null } });
      return NextResponse.json({ error: "could not record the payment" }, { status: 500 });
    }
    if (result.settled) return NextResponse.json({ ok: true, advert_invoice: invoiceId, settled: true });

    // Settled nothing. Harmless only when this same session already paid it
    // (a replay, or the return page beat us here). Anything else is money
    // taken for nothing owed — paid twice, paid after it was voided, or not
    // what the invoice says — and needs a human and probably a refund.
    if (result.reason === "paid" && result.paidSessionId === object.id) {
      return NextResponse.json({ ok: true, advert_invoice: invoiceId, settled: false, replay: true });
    }
    const amount = typeof object.amount_total === "number" ? `${formatPounds(object.amount_total)} ${(object.currency ?? "").toUpperCase()}`.trim() : "an unknown amount";
    const why =
      result.reason === "paid" ? `the invoice was already paid${result.paidSessionId ? ` by another checkout session (${result.paidSessionId})` : " (marked paid by hand)"}`
      : result.reason === "void" ? "the invoice had been cancelled (void) before the payment arrived"
      : result.reason === "amount_mismatch" ? "the amount paid doesn't match the invoice — nothing was released"
      : "no such invoice exists";
    logError({
      source: "webhook",
      area: `stripe-webhook:advert-unowed:${result.reason}`,
      error: new Error(`advert payment ${object.id} for invoice ${invoiceId} settled nothing: ${why}`),
      context: { invoice_id: invoiceId, session_id: object.id ?? null, reason: result.reason, amount_total: object.amount_total ?? null, currency: object.currency ?? null },
    });
    await notifyConsole({
      kind: "payment_taken",
      memberId: result.memberId ?? object.metadata.member_id ?? null,
      payload: result.memberId || object.metadata.member_id ? { member_id: (result.memberId ?? object.metadata.member_id)! } : {},
      message: `Check for a refund: a card payment of ${amount} (Stripe checkout ${object.id}) came in for an advertising invoice, but ${why}. Nothing was released — look it up in the Stripe dashboard.`,
    });
    return NextResponse.json({ ok: true, advert_invoice: invoiceId, settled: false, alerted: result.reason });
  }

  let memberId = event.data?.object?.client_reference_id ?? event.data?.object?.metadata?.member_id ?? null;
  if (!memberId) {
    const subscriptionId = event.data?.object?.subscription ?? event.data?.object?.parent?.subscription_details?.subscription;
    if (subscriptionId) memberId = await memberIdFromSubscription(subscriptionId);
  }
  if (!memberId) return NextResponse.json({ ok: true, ignored: "no member reference" });

  switch (event.type) {
    case "checkout.session.completed":
      // Keyed on the session so a Stripe retry of this event can't record the
      // join fee (invoice, PDF, receipt, Jas's note) a second time, and so the
      // pay page's return fast path and this can't both record it (B1.7).
      await recordMembershipCheckout(memberId, {
        sessionId: event.data?.object?.id ?? null,
        subscriptionId: event.data?.object?.subscription ?? null,
        customerId: event.data?.object?.customer ?? null,
      });
      break;
    case "invoice.payment_failed":
      await applyPaymentFailure(memberId);
      break;
    case "customer.subscription.deleted":
      // The period actually ended — either a cancel-at-period-end we
      // scheduled (B1.5) or something cancelled directly in the Stripe
      // dashboard. Either way the membership itself needs to reflect it.
      await applySubscriptionEnded(memberId);
      break;
    default:
      break; // other lifecycle events — nothing to mirror yet
  }

  return NextResponse.json({ ok: true });
}
