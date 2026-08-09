export const metadata = { title: "Checkout" };

/**
 * Stripe checkout is stubbed locally (Payments adapter, TECH-DECISIONS).
 * In production this redirects to a Stripe Checkout session; promo codes
 * (1 month / 12 months free) apply at this step.
 */
export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-md px-4 text-center">
      <div className="mt-12 rounded-xl bg-white p-8 shadow-sm">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-bold text-navy">Checkout (local stub)</h1>
        <p className="mt-2 text-sm text-gray-600">
          In production this hands off to Stripe Checkout — £40/month subscription,
          promo-code field included. No payment details ever touch SMI&apos;s servers.
        </p>
        <p className="mt-4 rounded bg-paper p-3 text-xs text-gray-500">
          Local dev: accounts are created via the seed script or the admin console.
        </p>
      </div>
    </div>
  );
}
