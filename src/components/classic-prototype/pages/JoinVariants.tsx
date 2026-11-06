import Image from "next/image";
import Link from "next/link";
import { focusStyle } from "@/lib/focus";
import { Banner, BlueButton, Panel } from "./bits";

/*
 * PROTOTYPE (issue #63). Two takes on /join in Classic, against the live
 * /become-a-member/ sales page (banner, alternating image/text rows, three
 * coloured icon discs, one blue "Sign up for Membership" button).
 *
 *   A2 "Live sales page": that layout, filled with OUR copy (price, steps,
 *      the four benefits). Photos are borrowed story covers, placeholders.
 *   A3 "Hybrid": the live banner, then our page's own structure (price
 *      first, benefits, how joining works) on Classic panels and buttons.
 *
 * Copy is today's /join copy throughout; this ticket is about layout.
 */
export type Photo = { src: string | null; focus: unknown };

const BENEFITS: [string, string, string][] = [
  ["🏢", "Your company page", "A permanent, Google-indexed profile with your story library, map, video and contact routes."],
  ["📰", "Post your own news", "Publish through SMI's site, newsletter and social channels — every story links back to you."],
  ["📈", "See your reach", "Statistics showing how often your page is viewed, how far your stories reach and how your adverts perform."],
  ["🤝", "Community", "Part of the UK's sheet metal trade network — events, the golf day, and the monthly newsletter."],
];
const STEPS: [string, string][] = [
  ["Create your account", "Company name, email, password — two minutes."],
  ["Pay £40/month", "Card via Stripe, or redeem a promo code."],
  ["Build your draft page", "Describe your company; we auto-fill what we know."],
  ["We verify and approve", "The editor checks your page — then you're live in the directory."],
];
// Live discs are orange, red, blue. Ink glyphs on orange; white only on red/blue.
const DISCS = ["bg-brand", "bg-[#e3141e]", "bg-[#3100ff]", "bg-brand"];

function Photo({ p }: { p: Photo }) {
  return (
    <div className="relative aspect-[5/4] overflow-hidden rounded-[5px] bg-graphite/15">
      {p.src && <Image src={p.src} alt="" fill sizes="(max-width: 768px) 100vw, 500px" style={focusStyle(p.focus)} className="object-cover" unoptimized />}
    </div>
  );
}

function Steps() {
  return (
    <ol className="mt-5 space-y-4">
      {STEPS.map(([t, d], i) => (
        <li key={t} className="flex gap-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-ink">{i + 1}</span>
          <span className="text-lg"><span className="text-black">{t}</span> <span className="text-[#666]">— {d}</span></span>
        </li>
      ))}
    </ol>
  );
}

export function JoinLiveShape({ photos }: { photos: Photo[] }) {
  return (
    <div>
      <Banner image={photos[0]?.src ?? null} focus={photos[0]?.focus} title="Become a Member" />
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <h2 className="text-[2.25rem] font-normal">£40 a month. That&rsquo;s the price.</h2>
            <p className="mt-4 text-lg leading-relaxed">No tiers, no seat licences, cancel anytime. Join 85+ UK sheet metal companies reaching thousands of trade readers every month.</p>
          </div>
          <Photo p={photos[1] ?? { src: null, focus: null }} />
        </div>
        <div className="mt-16 grid items-center gap-12 md:grid-cols-2">
          <div className="order-2 md:order-1"><Photo p={photos[2] ?? { src: null, focus: null }} /></div>
          <div className="order-1 md:order-2">
            <h2 className="text-[2.25rem] font-normal">How joining works</h2>
            <Steps />
          </div>
        </div>
        <div className="mt-20 grid gap-10 text-center sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(([icon, t, d], i) => (
            <div key={t}>
              <span aria-hidden="true" className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-2xl ${DISCS[i]}`}>{icon}</span>
              <h3 className="mt-4 text-[1.75rem] font-normal leading-tight">{t}</h3>
              <p className="mt-3 text-[#333]">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 text-center">
          <BlueButton href="/join/account">Sign up for Membership</BlueButton>
          <p className="mt-3 text-sm text-[#666]">Payments handled securely by Stripe.</p>
        </div>
      </div>
    </div>
  );
}

export function JoinHybrid({ photos }: { photos: Photo[] }) {
  return (
    <div>
      <Banner image={photos[0]?.src ?? null} focus={photos[0]?.focus} title="Become a Member" />
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Panel className="grid gap-8 md:grid-cols-[1fr_1.3fr] md:items-center">
          <div>
            <p className="text-[3.5rem] leading-none">£40<span className="text-2xl text-[#666]">/month</span></p>
            <p className="mt-3 text-lg">No tiers, no seat licences, cancel anytime. The price is the price, stated up front.</p>
            <div className="mt-6"><BlueButton href="/join/account">Join now — £40/month</BlueButton></div>
            <p className="mt-2 text-sm text-[#666]">Payments handled securely by Stripe.</p>
          </div>
          <div className="border-t-2 border-[#e2e2e2] pt-6 md:border-l-2 md:border-t-0 md:pl-8 md:pt-0">
            <h2 className="text-2xl font-normal">How joining works</h2>
            <Steps />
          </div>
        </Panel>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {BENEFITS.map(([icon, t, d], i) => (
            <Panel key={t} className="flex gap-5">
              <span aria-hidden="true" className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-xl ${DISCS[i]}`}>{icon}</span>
              <div>
                <h3 className="text-2xl font-normal">{t}</h3>
                <p className="mt-2 text-[#333]">{d}</p>
              </div>
            </Panel>
          ))}
        </div>
        <p className="mt-10 text-center text-lg">Join 85+ UK sheet metal companies. <Link href="/member" className="text-[#3100ff] hover:text-[#1d0099]">See who&rsquo;s already a member ›</Link></p>
      </div>
    </div>
  );
}
