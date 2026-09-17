import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applyPaymentResult, applyPaymentFailure, applySubscriptionEnded } from "@/lib/membership";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";
import { serviceDb } from "@/lib/db/server";

/**
 * Stripe events → membership state (GAPS B1.3/B1.4).
 *
 * Hand-rolled signature verification rather than the `stripe` package, matching
 * every other adapter in this repo (no vendor SDKs). Stripe's scheme: the
 * `Stripe-Signature` header carries `t=<unix ts>,v1=<hex hmac>[,v0=...]`; the
 * signed payload is `${t}.${rawBody}`, keyed with the webhook signing secret.
 */

const TOLERANCE_MS = 5 * 60_000;

function verify(secret: string, header: string | null, body: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v] as const;
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > TOLERANCE_MS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const candidate = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf);
}

type StripeEvent = {
  type?: string;
  data?: {
    object?: {
      client_reference_id?: string;
      metadata?: { member_id?: string };
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

  let memberId = event.data?.object?.client_reference_id ?? event.data?.object?.metadata?.member_id ?? null;
  if (!memberId) {
    const subscriptionId = event.data?.object?.subscription ?? event.data?.object?.parent?.subscription_details?.subscription;
    if (subscriptionId) memberId = await memberIdFromSubscription(subscriptionId);
  }
  if (!memberId) return NextResponse.json({ ok: true, ignored: "no member reference" });

  switch (event.type) {
    case "checkout.session.completed": {
      await applyPaymentResult(memberId, { kind: "paid" });
      // B1.5: remembered so a later cancel action has something of ours to
      // act on — neither column was ever written before this.
      const subscriptionId = event.data?.object?.subscription;
      const customerId = event.data?.object?.customer;
      if (subscriptionId || customerId) {
        await serviceDb().from("members").update({
          ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
          ...(customerId ? { stripe_customer_id: customerId } : {}),
        }).eq("id", memberId);
      }
      break;
    }
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
