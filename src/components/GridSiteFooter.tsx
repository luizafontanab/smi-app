import Image from "next/image";
import Link from "next/link";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { NewsletterSignup } from "@/components/NewsletterSignup";

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

const SITE_LINKS = [
  { href: "/pages/about", label: "About" },
  { href: "/pages/policies", label: "Policies" },
  { href: "/pages/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function GridSiteFooter() {
  return (
    <footer className="bg-[var(--gh-footer)] text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Image
            src="/logo-stacked.png"
            alt="Sheet Metal Industries"
            width={500}
            height={172}
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
                className="tap text-white/70 hover:text-brand"
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

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand">Monthly newsletter</p>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            UK sheet metal news, machinery launches and event dates, for free.
          </p>
          <div className="mt-4">
            <NewsletterSignup />
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 py-5 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Sheet Metal Industries. All rights reserved.
      </div>
    </footer>
  );
}
