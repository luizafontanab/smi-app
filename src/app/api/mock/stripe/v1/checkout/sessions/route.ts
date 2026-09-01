import { NextResponse, type NextRequest } from "next/server";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";
import { encodeMockSession } from "@/lib/adapters/stripe-mock-session";

/**
 * Fake `POST /v1/checkout/sessions` (Stripe's real shape: form-urlencoded in,
 * `{id, url}` JSON out). Only live when `mockBaseUrl()` is set — see
 * `lib/adapters/mock-base-url.ts` — so this can never be reached on a real
 * production deployment even if the route is guessed.
 */
export async function POST(request: NextRequest) {
  if (!mockBaseUrl()) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = new URLSearchParams(await request.text());
  const memberId = form.get("client_reference_id") ?? "";
  const email = form.get("customer_email") ?? "";
  const successUrl = form.get("success_url") ?? "";
  const cancelUrl = form.get("cancel_url") ?? "";

  const id = `mock_cs_${encodeMockSession({ memberId, email, successUrl, cancelUrl })}`;
  return NextResponse.json({ id, url: `${mockBaseUrl()}/mock/stripe/checkout/${id}` });
}
