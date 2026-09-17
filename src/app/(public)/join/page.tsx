import Link from "next/link";

export const metadata = {
  title: "Become a Member",
  description: "Join Sheet Metal Industries for £40/month — a company page, news coverage, and a direct line to the UK sheet metal trade.",
  alternates: { canonical: "/join" },
};

const BENEFITS = [
  ["Your company page", "A permanent, Google-indexed profile with your story library, map, video and contact routes."],
  ["Post your own news", "Publish through SMI's site, newsletter and social channels — every story links back to you."],
  ["See who's engaging", "Analytics showing readership and which companies are looking at your page and machines."],
  ["Community", "Part of the UK's sheet metal trade network — events, the golf day, and the monthly newsletter."],
];

const STEPS = [
  ["Create your account", "Company name, email, password — two minutes."],
  ["Pay £40/month", "Card via Stripe, or redeem a promo code."],
  ["Build your draft page", "Describe your company; we auto-fill what we know."],
  ["We verify and approve", "The editor checks your page — then you're live in the directory."],
];

export default function JoinPage() {
  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mt-8 text-center">
        <h1 className="text-3xl font-bold text-ink">Become a Member</h1>
        <p className="mx-auto mt-3 max-w-xl text-graphite">
          <span className="text-2xl font-bold text-ink">£40/month</span> — no tiers, no seat licences, cancel anytime.
          The price is the price, stated up front.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-graphite">
          Join 85+ UK sheet metal companies reaching thousands of trade readers every month.
        </p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map(([title, detail]) => (
          <div key={title} className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="font-bold text-ink">{title}</h2>
            <p className="mt-1 text-sm text-graphite">{detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-xl bg-ink p-8 text-center text-white">
        <h2 className="text-xl font-bold">How joining works</h2>
        <ol className="mx-auto mt-4 max-w-md space-y-3 text-left text-sm">
          {STEPS.map(([title, detail], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-ink">{i + 1}</span>
              <span><b>{title}</b> <span className="text-white/70">— {detail}</span></span>
            </li>
          ))}
        </ol>
        <Link href="/join/account" className="mt-6 inline-block rounded bg-brand px-6 py-3 font-semibold text-ink">
          Join now — £40/month
        </Link>
        <p className="mt-3 text-xs text-white/50">Payments handled securely by Stripe.</p>
      </div>
      <div className="my-10" />
    </div>
  );
}
