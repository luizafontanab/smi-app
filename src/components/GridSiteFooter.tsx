import Image from "next/image";
import Link from "next/link";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { SIGNUP_SURFACES } from "@/lib/newsletter-consent";

/**
 * The grid design's footer, from comp v2: a charcoal band under the page's
 * near-black closing CTA, so the two read as separate surfaces rather than one
 * long dark run. Forge keeps the near-black SiteFooter; the public layout picks
 * between them on the theme cookie.
 *
 * Comp v1's alternative is a solid orange footer. It is the more striking of
 * the two and it is not used here: almost all of its text is white on orange,
 * which measures 2.5:1 and fails AA at any size (the table at the top of
 * globals.css). This design keeps the comps' palette everywhere it passes.
 *
 * The newsletter column is kept even though neither comp's footer has one —
 * the grid homepage carries its own orange signup panel, but this footer is on
 * every other grid-mode page too, and dropping it would quietly remove the
 * signup from all of them.
 */

/*
 * Terms are linked from here because terms nobody can reach bind nobody —
 * there is no other route into /pages/terms, and a member agreeing to
 * membership has to be able to find what they agreed to. Membership terms
 * get their own row beside Policies — the 18 Sep call asked for a Membership
 * policy alongside the cookie policy (REQUIREMENTS §3, GAPS A9.6); advertising
 * terms still hang off the Terms page.
 */
const SITE_LINKS = [
  { href: "/pages/about", label: "About" },
  { href: "/pages/terms", label: "Terms" },
  { href: "/pages/policies", label: "Policies" },
  { href: "/pages/membership-terms", label: "Membership terms" },
  { href: "/pages/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function GridSiteFooter() {
  return (
    <footer className="bg-[var(--gh-footer)] text-white">
      {/* Three columns only from lg: at tablet width the third left the
          newsletter field ~105px wide (#33), so there it spans a full row
          under the other two. */}
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Image
            src="/logo-stacked.svg"
            alt="Sheet Metal Industries"
            width={819}
            height={270}
            className="h-16 w-auto"
          />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/70">
            The voice of the UK sheet metal, fabrication and welding trade.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
            {SOCIAL_CHANNELS.map((c) => (
              <a
                key={c.key}
                href={SMI_SOCIAL_URLS[c.key]}
                target="_blank"
                rel="noopener"
                aria-label={c.label}
                // A 44px-wide floor on touch too: "X" alone was 7px wide (#33).
                className="tap text-white/70 hover:text-brand [@media(pointer:coarse)]:min-w-11"
              >
                {c.label}
              </a>
            ))}
          </div>
        </div>

        <nav aria-label="Footer">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand">Site</p>
          <ul className="mt-3 grid gap-1.5 text-sm text-white/80">
            {SITE_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="tap hover:text-brand">{l.label}</Link>
              </li>
            ))}
            <li><CookieSettingsLink /></li>
          </ul>
        </nav>

        <div className="md:col-span-2 lg:col-span-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand">{SIGNUP_SURFACES.grid_footer.heading}</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            {SIGNUP_SURFACES.grid_footer.blurb}
          </p>
          <div className="mt-4 max-w-md">
            <NewsletterSignup surface="grid_footer" />
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 py-5 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Sheet Metal Industries. All rights reserved.
      </div>
    </footer>
  );
}
