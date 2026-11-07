import Link from "next/link";

/** The four membership benefits, [title, detail]. Exported so the Classic join view (#78) shows the same copy. */
export const JOIN_BENEFITS: readonly (readonly [string, string])[] = [
  ["Your company page", "A permanent, Google-indexed profile with your story library, map, video and contact routes."],
  ["Post your own news", "Publish through SMI's site, newsletter and social channels — every story links back to you."],
  ["See your reach", "Statistics showing how often your page is viewed, how far your stories reach and how your adverts perform."],
  ["Community", "Part of the UK's sheet metal trade network — events, the golf day, and the monthly newsletter."],
];

/** How joining works, [title, detail], in order. Exported for the Classic join view (#78). */
export const JOIN_STEPS: readonly (readonly [string, string])[] = [
  ["Create your account", "Company name, email, password — two minutes."],
  ["Pay £40/month", "Card via Stripe, or redeem a promo code."],
  ["Build your draft page", "Describe your company; we auto-fill what we know."],
  ["We verify and approve", "The editor checks your page — then you're live in the directory."],
];

/**
 * Current's /join. The route renders this through the design-option hook
 * point (src/components/design-option.ts), never directly.
 */
export function JoinPageView() {
  return (
    <div data-part="join-page" className="mx-auto max-w-4xl px-4">
      <div data-part="page-head" className="mt-8 text-center">
        <h1 data-part="page-title" className="text-3xl font-bold text-ink">Become a Member</h1>
        <p data-part="join-price" className="mx-auto mt-3 max-w-xl text-graphite">
          <span className="text-2xl font-bold text-ink">£40/month</span> — no tiers, no seat licences, cancel anytime.
          The price is the price, stated up front.
        </p>
        <p data-part="page-intro" className="mx-auto mt-2 max-w-xl text-sm text-graphite">
          Join 85+ UK sheet metal companies reaching thousands of trade readers every month.
        </p>
        {/* Phones only: the band's Join button sits about two screens down
            once the benefit cards stack, so the price gets its own (#33). Worded
            apart from "Join now" so join.spec's text selector still finds the
            band's button first. */}
        <Link href="/join/account" data-part="button-primary" className="mt-5 flex min-h-11 w-full items-center justify-center rounded bg-brand px-6 font-semibold text-ink sm:hidden">
          Join for £40/month
        </Link>
      </div>
      <div data-part="join-benefits" className="mt-8 grid gap-4 sm:grid-cols-2">
        {JOIN_BENEFITS.map(([title, detail]) => (
          <div key={title} data-part="join-benefit" className="rounded-lg bg-white p-5 shadow-sm">
            <h2 data-part="card-title" className="font-bold text-ink">{title}</h2>
            <p data-part="card-excerpt" className="mt-1 text-sm text-graphite">{detail}</p>
          </div>
        ))}
      </div>
      {/* Light band, matching the JoinCta band: the grid design reads light,
          and this was the page's one near-black panel (#33). */}
      <div data-part="join-steps" className="mt-8 rounded-xl border border-brand/30 bg-brand/10 p-6 text-center text-ink sm:p-8">
        <h2 data-part="section-title" className="text-xl font-bold">How joining works</h2>
        <ol className="mx-auto mt-4 max-w-md space-y-3 text-left text-base sm:text-sm">
          {JOIN_STEPS.map(([title, detail], i) => (
            <li key={title} className="flex gap-3">
              <span data-part="join-step-number" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-ink">{i + 1}</span>
              <span><b>{title}</b> <span className="text-graphite">— {detail}</span></span>
            </li>
          ))}
        </ol>
        <Link href="/join/account" data-part="button-primary" className="mt-6 inline-block rounded bg-brand px-6 py-3 font-semibold text-ink">
          Join now — £40/month
        </Link>
        <p data-part="join-stripe-note" className="mt-3 text-xs text-graphite">Payments handled securely by Stripe.</p>
      </div>
      <div className="my-10" />
    </div>
  );
}
