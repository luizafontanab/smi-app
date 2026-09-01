import { siteUrl } from "../site-url";

/**
 * Preview-only escape hatch: when `MOCK_INTEGRATIONS=1` is set on a Vercel
 * Preview deployment, vendor adapters (Stripe, Bigin) call this deployment's
 * own `/api/mock/*` routes instead of the real vendor, so a Preview build can
 * exercise a real HTTP round-trip — webhooks, error codes — without a live
 * vendor account. `VERCEL_ENV === "production"` is a hard safety net: even a
 * mis-set env var can never point a production deployment at the mock routes.
 */
export function mockBaseUrl(): string | null {
  if (process.env.MOCK_INTEGRATIONS !== "1") return null;
  if (process.env.VERCEL_ENV === "production") return null;
  return siteUrl();
}
