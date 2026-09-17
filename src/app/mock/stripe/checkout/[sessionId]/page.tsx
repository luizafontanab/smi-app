import { notFound } from "next/navigation";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";
import { decodeMockSession } from "@/lib/adapters/stripe-mock-session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock Stripe checkout" };

/**
 * Stand-in for Stripe's hosted checkout page, only reachable when
 * `MOCK_INTEGRATIONS=1` is set (Preview only — see `lib/adapters/mock-base-url.ts`).
 * "Pay" and "decline" both fire a real, signed webhook at
 * `/api/stripe/webhook` via `/api/mock/stripe/simulate`, so a Preview build
 * exercises the same code path a live Stripe account would.
 */
export default async function MockStripeCheckout(props: PageProps<"/mock/stripe/checkout/[sessionId]">) {
  if (!mockBaseUrl()) notFound();
  const { sessionId } = await props.params;
  const session = decodeMockSession(sessionId.replace(/^mock_cs_/, ""));
  if (!session) notFound();

  return (
    <div className="mx-auto max-w-md p-8">
      <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Mock Stripe checkout</p>
        <h1 className="mt-1 text-xl font-bold text-ink">£40.00/month subscription</h1>
        <p className="mt-1 text-sm text-graphite">{session.email}</p>
        <p className="mt-4 text-sm text-graphite">
          This is a stand-in for Stripe&apos;s hosted checkout, used only in Preview deployments. No card is charged.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a
            href={`/api/mock/stripe/simulate?sessionId=${encodeURIComponent(sessionId)}&outcome=completed`}
            className="rounded bg-brand px-4 py-2 text-center text-sm font-semibold text-ink"
          >
            Simulate successful payment
          </a>
          <a
            href={`/api/mock/stripe/simulate?sessionId=${encodeURIComponent(sessionId)}&outcome=failed`}
            className="rounded border border-line px-4 py-2 text-center text-sm font-semibold text-ink"
          >
            Simulate card decline
          </a>
        </div>
      </div>
    </div>
  );
}
