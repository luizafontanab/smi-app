import Link from "next/link";
import { JOIN_BENEFITS, JOIN_STEPS } from "@/components/join/JoinPageView";

/** Decorative glyph per benefit, by JOIN_BENEFITS title. The disc colours are in classic.css #78. */
const BENEFIT_GLYPHS: Readonly<Record<string, string>> = {
  "Your company page": "🏢",
  "Post your own news": "📰",
  "See your reach": "📈",
  Community: "🤝",
};

/**
 * Classic's join page (hook point `JoinView` in src/components/design-option.ts;
 * spec #68, ticket #78, variant "Hybrid"):
 *
 *   · A full-width banner with "Become a Member" in white, like the live site.
 *     The banner has no photo yet. classic.css #78 paints a PLACEHOLDER gradient
 *     until a real photo is supplied (docs/HUMAN-TODO.md 7.5). Never use a
 *     borrowed story cover here.
 *   · Then Current's structure on Classic panels: the price, the Join now button
 *     and the Stripe note, beside "How joining works", then the four benefits
 *     as white panels with coloured discs.
 *
 * The copy is Current's, word for word. The benefits and steps come from
 * JoinPageView's exported constants. The few inline lines are checked against
 * Current's rendered page by tests/unit/classic/join-view.test.tsx.
 *
 * Current's phone-only "Join for £40/month" button is left out. Here the price
 * panel, with its Join now button, sits straight under the banner on phones.
 */
export function ClassicJoinView() {
  return (
    <div data-part="join-page">
      <div data-part="join-banner">
        <div data-part="join-banner-inner">
          <h1 data-part="page-title">Become a Member</h1>
        </div>
      </div>
      <div data-part="join-body">
        <div data-part="join-price-panel">
          <div data-part="join-offer">
            <p data-part="join-price">
              <span data-part="join-price-amount">£40/month</span> — no tiers, no seat licences, cancel anytime.
              The price is the price, stated up front.
            </p>
            <p data-part="page-intro">
              Join 85+ UK sheet metal companies reaching thousands of trade readers every month.
            </p>
            <Link href="/join/account" data-part="button-primary">Join now — £40/month</Link>
            <p data-part="join-stripe-note">Payments handled securely by Stripe.</p>
          </div>
          <div data-part="join-steps">
            <h2 data-part="section-title">How joining works</h2>
            <ol>
              {JOIN_STEPS.map(([title, detail], i) => (
                <li key={title}>
                  <span data-part="join-step-number">{i + 1}</span>
                  <span><b>{title}</b> <span data-part="join-step-detail">— {detail}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div data-part="join-benefits">
          {JOIN_BENEFITS.map(([title, detail]) => (
            <div key={title} data-part="join-benefit">
              <span data-part="join-benefit-disc" aria-hidden="true">{BENEFIT_GLYPHS[title]}</span>
              <div>
                <h3 data-part="card-title">{title}</h3>
                <p data-part="card-excerpt">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
