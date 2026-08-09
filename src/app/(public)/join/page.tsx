import Link from "next/link";

export const metadata = { title: "Become a Member" };

const BENEFITS = [
  ["Your company page", "A permanent, Google-indexed profile with your story library, map, video and contact routes."],
  ["Post your own news", "Publish through SMI's site, newsletter and social channels — every story links back to you."],
  ["See who's engaging", "Analytics showing readership and which companies are looking at your page and machines."],
  ["Community", "Part of the UK's sheet metal trade network — events, the golf day, and the monthly newsletter."],
];

export default function JoinPage() {
  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mt-8 text-center">
        <h1 className="text-3xl font-bold text-navy">Become a Member</h1>
        <p className="mx-auto mt-3 max-w-xl text-gray-600">
          <span className="text-2xl font-bold text-navy">£40/month</span> — no tiers, no seat licences, cancel anytime.
          The price is the price, stated up front.
        </p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map(([title, detail]) => (
          <div key={title} className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="font-bold text-navy">{title}</h2>
            <p className="mt-1 text-sm text-gray-600">{detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-xl bg-navy p-8 text-center text-white">
        <h2 className="text-xl font-bold">Ready to join?</h2>
        <ol className="mx-auto mt-3 max-w-md space-y-1 text-left text-sm text-white/80">
          <li>1. Create your account and company page</li>
          <li>2. Pay by card (or redeem a promo code)</li>
          <li>3. We approve your page and you&apos;re live</li>
        </ol>
        <Link href="/join/checkout" className="mt-5 inline-block rounded bg-amber px-6 py-3 font-semibold text-navy">
          Join now — £40/month
        </Link>
        <p className="mt-3 text-xs text-white/50">Payments handled securely by Stripe.</p>
      </div>
      <div className="my-10" />
    </div>
  );
}
