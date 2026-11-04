import { redirect } from "next/navigation";
import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { MEMBERSHIP_CHECKOUT_KIND, membershipCheckoutIsEmbedded, paymentsAreLive } from "@/lib/adapters/payments";
import { retrieveCheckoutSession, STRIPE_JS_URL, stripePublishableKey } from "@/lib/adapters/advert-checkout";
import { recordMembershipCheckout } from "@/lib/membership";
import { PayForm } from "./PayForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay for your membership" };

/**
 * V13 step 2 of 4. With live Stripe the card form is Stripe's embedded
 * Checkout in a modal (GAPS B1.7), and Stripe sends the member back here with
 * `?session_id=` once they pay. The session is read straight back and
 * recorded on the spot, so the member goes on to step 3 at once instead of
 * waiting on the webhook. Both go through recordMembershipCheckout(), keyed
 * on the session, so whichever is first wins and the other is a no-op.
 */
export default async function MemberPayPage(props: PageProps<"/dashboard/pay">) {
  const user = await requireMemberView();
  const sp = await props.searchParams;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : null;
  // An admin viewing as the member only looks: nothing is recorded on render
  // and no payment form is shown (its action would bounce them anyway).
  const readOnly = user.viewingAs !== null;
  const load = () =>
    serviceDb().from("members").select("status, paid_at, comped_until").eq("id", user.memberId).single();

  let { data: member } = await load();
  if (member && !member.paid_at && !readOnly && sessionId && membershipCheckoutIsEmbedded()) {
    const session = await retrieveCheckoutSession(sessionId);
    // Only a session this member paid for: the id in the URL is not proof.
    const theirs = session?.kind === MEMBERSHIP_CHECKOUT_KIND
      && session.clientReferenceId === user.memberId
      && session.status === "complete"
      && session.paymentStatus === "paid";
    if (theirs) {
      try {
        await recordMembershipCheckout(user.memberId, {
          sessionId,
          subscriptionId: session.subscriptionId,
          customerId: session.customerId,
        });
      } catch (e) {
        // The webhook is the authority and retries until it lands; the page
        // says "not confirmed yet" below rather than erroring.
        console.error(`[pay] return-page record failed for member ${user.memberId}:`, e);
      }
      ({ data: member } = await load());
    }
  }
  // Paid via this return, or the webhook got there first.
  if (member?.paid_at && sessionId) redirect("/dashboard?submitted=paid");
  if (!member || member.paid_at || member.comped_until || member.status !== "draft") redirect("/dashboard");

  const isLocalStub = !paymentsAreLive();
  const publishableKey = stripePublishableKey();
  const embed = membershipCheckoutIsEmbedded() && publishableKey ? { publishableKey, stripeJsUrl: STRIPE_JS_URL } : null;
  return (
    <div className="max-w-md lg:mx-auto">
      <div className="rounded-xl bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-text">Step 2 of 4</p>
        <h1 className="mt-1 text-xl font-bold text-ink">Pay — £40/month</h1>
        <p className="mt-1 text-sm text-graphite">
          Payment is handled by Stripe — card details never touch SMI&apos;s servers. Then you build your page and we approve it.
        </p>
        {sessionId && (
          <p role="status" className="mt-3 rounded bg-brand/10 p-2 text-sm text-ink">
            We haven&apos;t received confirmation of that payment yet. If your bank is still processing it, reload this page in a
            minute. Otherwise you can try again below.
          </p>
        )}
        {isLocalStub && (
          <p className="mt-3 rounded bg-brand/10 p-2 text-xs text-graphite">
            <strong>Simulated payment — no card is charged, no money moves.</strong> Clicking pay below will mark this
            membership as paid without Stripe. Promo codes <code>SMI-FREE-MONTH</code> / <code>SMI-FREE-YEAR</code> also work.
          </p>
        )}
        {readOnly ? (
          <p className="mt-5 text-sm text-graphite">The payment form is hidden while you&apos;re viewing as a member.</p>
        ) : (
          <PayForm embed={embed} />
        )}
      </div>
    </div>
  );
}
