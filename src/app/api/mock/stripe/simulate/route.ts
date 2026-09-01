import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";
import { decodeMockSession } from "@/lib/adapters/stripe-mock-session";

/**
 * Fires a real, signed webhook at `/api/stripe/webhook` — this is how
 * `checkout.session.completed` / `invoice.payment_failed` get exercised in
 * Preview without a live Stripe account. Only live when `mockBaseUrl()` is
 * set (see `lib/adapters/mock-base-url.ts`).
 */
function sign(secret: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export async function GET(request: NextRequest) {
  const base = mockBaseUrl();
  if (!base) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  const outcome = request.nextUrl.searchParams.get("outcome");
  const session = decodeMockSession(sessionId.replace(/^mock_cs_/, ""));
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });

  const event =
    outcome === "completed"
      ? { type: "checkout.session.completed", data: { object: { client_reference_id: session.memberId } } }
      : { type: "invoice.payment_failed", data: { object: { metadata: { member_id: session.memberId } } } };
  const body = JSON.stringify(event);

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (secret) {
    const res = await fetch(`${base}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": sign(secret, body) },
      body,
    });
    if (!res.ok) console.warn(`[mock-stripe] webhook call rejected (${res.status})`);
  } else {
    console.warn("[mock-stripe] STRIPE_WEBHOOK_SECRET is not set — the webhook will reject this, membership state will not update.");
  }

  return NextResponse.redirect(outcome === "completed" ? session.successUrl : session.cancelUrl);
}
