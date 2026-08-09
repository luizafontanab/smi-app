import { CheckoutForm } from "./CheckoutForm";

export const metadata = { title: "Checkout" };

/**
 * Stripe Checkout hand-off in production; locally the payment step is
 * simulated so the full join flow works end-to-end. Promo codes work in both.
 */
export default function CheckoutPage() {
  const isLocalStub = !process.env.STRIPE_SECRET_KEY;
  return (
    <div className="mx-auto max-w-md px-4">
      <div className="mt-10 rounded-xl bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-navy">Join — £40/month</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create your account and company page. Payment is handled by Stripe — card details never touch SMI&apos;s servers.
        </p>
        {isLocalStub && (
          <p className="mt-3 rounded bg-amber/10 p-2 text-xs text-gray-600">
            Local dev: payment is simulated. Promo codes <code>SMI-FREE-MONTH</code> / <code>SMI-FREE-YEAR</code> also work.
          </p>
        )}
        <CheckoutForm />
      </div>
    </div>
  );
}
