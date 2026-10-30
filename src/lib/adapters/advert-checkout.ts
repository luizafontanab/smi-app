/**
 * One-off Stripe payments for advertising (6 Oct) — embedded Checkout.
 *
 * Deliberately separate from `./payments.ts`, which is the membership
 * subscription and is never touched by this (B1.6: existing subscriptions are
 * never altered). Same house rules as that adapter: raw `fetch` against the
 * REST API, no `stripe` package.
 *
 * Pinned to the 2026-03-25.dahlia API version, the release that introduced
 * `ui_mode: "embedded_page"`, and paired with the dahlia Stripe.js the pay
 * page loads (`STRIPE_JS_URL`) — Stripe asks that the two stay on the same
 * release train. Pinning per request means the SMI account's own default
 * version, whatever it is when the account is created, can't change what
 * these requests mean.
 */

import { mockBaseUrl } from "./mock-base-url";

export const STRIPE_API_VERSION = "2026-03-25.dahlia";
export const STRIPE_JS_URL = "https://js.stripe.com/dahlia/stripe.js";

/**
 * How advert invoices get paid in this environment.
 *
 * - `stripe` — both keys present and not pointed at the Preview mocks: real
 *   embedded Checkout.
 * - `simulated` — local dev, or a Preview running MOCK_INTEGRATIONS: a
 *   "Pay (simulated)" button settles the invoice directly, so the whole hold →
 *   pay → live loop can be exercised with no Stripe account. Stripe.js can't
 *   run against the mock API, which is why mocks simulate too.
 * - `off` — production without keys. Nothing is held for payment then
 *   (src/lib/advert-payments.ts): runs schedule as they always did and Jas
 *   invoices by hand, so a missing key can never strand a paid-for advert.
 */
export type AdvertPaymentsMode = "stripe" | "simulated" | "off";

export function advertPaymentsMode(): AdvertPaymentsMode {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (mockBaseUrl()) return "simulated";
  if (secret && publishable) return "stripe";
  return process.env.NODE_ENV === "production" ? "off" : "simulated";
}

export function stripePublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null;
}

/** Marks a Checkout Session as an advert invoice, so the webhook never mistakes it for membership. */
export const ADVERT_INVOICE_KIND = "advert_invoice";

export type InvoiceCheckoutRequest = {
  invoiceId: string;
  invoiceNumber: string;
  memberId: string;
  email: string | null;
  description: string;
  amountPennies: number;
  returnUrl: string;
  /**
   * The session this one replaces (the invoice's last, now expired or
   * unusable), or null for an invoice's first. Part of the idempotency key:
   * two tabs opening checkout from the same state send the same key and get
   * the same session back, rather than one payable session each.
   */
  replacesSessionId: string | null;
};

export type InvoiceCheckoutResult =
  | { ok: true; clientSecret: string; sessionId: string; expiresAt: string }
  | { ok: false; error: string };

function stripeHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
}

/** Stripe's Checkout Session ids — checked before one is put in a URL path. */
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;

/** Creates the embedded Checkout Session for one invoice. Only meaningful in `stripe` mode. */
export async function createInvoiceCheckout(req: InvoiceCheckoutRequest): Promise<InvoiceCheckoutResult> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, error: "Online payments are not configured." };

  // One clock reading for both the idempotency key and expires_at: Stripe
  // rejects a reused key whose parameters differ, so two requests carrying
  // the same key must be byte-identical.
  const minute = Math.floor(Date.now() / 60_000);
  const expiresAt = (minute + 60) * 60;
  const body = new URLSearchParams({
    mode: "payment",
    ui_mode: "embedded_page",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][unit_amount]": String(req.amountPennies),
    "line_items[0][price_data][product_data][name]": req.description.slice(0, 250),
    client_reference_id: req.memberId,
    "metadata[kind]": ADVERT_INVOICE_KIND,
    "metadata[invoice_id]": req.invoiceId,
    "metadata[member_id]": req.memberId,
    // Copied onto the PaymentIntent, so a payment found in the Stripe
    // dashboard can be traced back to its SMI invoice without the session.
    "payment_intent_data[metadata][invoice_id]": req.invoiceId,
    "payment_intent_data[description]": `${req.invoiceNumber} — ${req.description}`.slice(0, 1000),
    return_url: req.returnUrl,
    // An hour, not Stripe's default 24 (it allows 30 minutes to 24 hours):
    // the invoice can be voided meanwhile, and although voidInvoices()
    // expires the open session, a shorter-lived one narrows the window if
    // that call fails.
    expires_at: String(expiresAt),
  });
  if (req.email) body.set("customer_email", req.email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      ...stripeHeaders(secret),
      // Keyed on what this session replaces, not only on the clock: every
      // request made from the same state of the invoice is the same request,
      // so two tabs racing to open checkout get one session between them.
      // The minute stays in the key because expires_at is in the body.
      "Idempotency-Key": `invoice-checkout-${req.invoiceId}-${req.replacesSessionId ?? "first"}-${minute}`,
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Stripe rejected the checkout (${res.status}): ${detail.slice(0, 300)}` };
  }
  const session = (await res.json()) as { id?: string; client_secret?: string };
  if (!session.client_secret || !session.id) return { ok: false, error: "Stripe did not return a checkout session." };
  return { ok: true, clientSecret: session.client_secret, sessionId: session.id, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export type CheckoutSessionState = {
  status: string | null;
  paymentStatus: string | null;
  invoiceId: string | null;
  kind: string | null;
  /** Present on an embedded_page session; what Stripe.js mounts with. */
  clientSecret: string | null;
  amountTotal: number | null;
  currency: string | null;
  /** The membership return check (GAPS B1.7) needs who it was for and what it created. */
  clientReferenceId: string | null;
  memberId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
};

/**
 * Reads a session back: on the return page — the fast path that settles the
 * invoice before the webhook arrives, so the member sees "paid" at once — and
 * when the pay page reopens an invoice's open session instead of making a
 * second one. The webhook stays the authority; settling is idempotent, so
 * both may run.
 */
export async function retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState | null> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !SESSION_ID_RE.test(sessionId)) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: stripeHeaders(secret) });
  if (!res.ok) return null;
  const s = (await res.json()) as {
    status?: string;
    payment_status?: string;
    metadata?: Record<string, string>;
    client_secret?: string | null;
    amount_total?: number | null;
    currency?: string | null;
    client_reference_id?: string | null;
    subscription?: string | null;
    customer?: string | null;
  };
  return {
    status: s.status ?? null,
    paymentStatus: s.payment_status ?? null,
    invoiceId: s.metadata?.invoice_id ?? null,
    kind: s.metadata?.kind ?? null,
    clientSecret: s.client_secret ?? null,
    amountTotal: typeof s.amount_total === "number" ? s.amount_total : null,
    currency: s.currency ?? null,
    clientReferenceId: s.client_reference_id ?? null,
    memberId: s.metadata?.member_id ?? null,
    // Unexpanded, these are ids; typeof guards against an expanded object.
    subscriptionId: typeof s.subscription === "string" ? s.subscription : null,
    customerId: typeof s.customer === "string" ? s.customer : null,
  };
}

export type ExpireResult =
  | { ok: true }
  /** The session could not be expired; `status` is what Stripe says it is now, when it could be read. */
  | { ok: false; status: string | null; error: string };

/**
 * Ends an open Checkout Session so it can no longer be paid
 * (POST /v1/checkout/sessions/{id}/expire — Stripe allows it only while the
 * session is `open`). On a refusal the session is read back, so the caller
 * can tell "already expired" (fine) from "complete" (the member paid while it
 * was being cancelled — the invoice must not be voided under them).
 */
export async function expireCheckoutSession(sessionId: string): Promise<ExpireResult> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, status: null, error: "Online payments are not configured." };
  if (!SESSION_ID_RE.test(sessionId)) return { ok: false, status: null, error: "Not a Checkout Session id." };
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
    method: "POST",
    headers: stripeHeaders(secret),
  });
  if (res.ok) return { ok: true };
  const detail = await res.text().catch(() => "");
  const now = await retrieveCheckoutSession(sessionId);
  return { ok: false, status: now?.status ?? null, error: `Stripe refused to expire ${sessionId} (${res.status}): ${detail.slice(0, 300)}` };
}
