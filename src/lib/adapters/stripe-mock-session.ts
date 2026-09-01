/**
 * Encode/decode for the mock Stripe checkout session id — shared by the two
 * mock routes (`/api/mock/stripe/v1/checkout/sessions` creates it, the
 * `/mock/stripe/checkout/[sessionId]` page and `/api/mock/stripe/simulate`
 * route decode it). Stateless on purpose: no DB row, so a Preview deployment
 * with no persistence still round-trips a full checkout.
 */
export type MockSession = { memberId: string; email: string; successUrl: string; cancelUrl: string };

export function encodeMockSession(session: MockSession): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

export function decodeMockSession(id: string): MockSession | null {
  try {
    return JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as MockSession;
  } catch {
    return null;
  }
}
