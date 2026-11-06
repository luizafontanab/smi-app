import Image from "next/image";
import Link from "next/link";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { SocialIcon } from "@/components/social-icons";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { SIGNUP_SURFACES } from "@/lib/newsletter-consent";
import { ClassicJoinBand } from "./ClassicJoinBand";

/**
 * Classic's site footer (hook point `Footer` in src/components/design-option.ts;
 * spec #68, #72). Top to bottom: a white "Back to Top" strip, the orange
 * "Become a Member." band (hidden on the join pages; see ClassicJoinBand), and
 * the black centred stack of sign-up, socials, site links and legal line. No
 * advert carousel (#66). All three sit inside the one <footer> landmark, so
 * nothing at the foot of the page falls outside a landmark.
 *
 * No props: the layout passes nothing, and the band reads the path itself.
 * The look lives in the #72 section of classic.css, keyed on the data-parts.
 */

/*
 * The same links, in the same order, as Current's GridSiteFooter. Terms and
 * membership terms have no other route in, so dropping one here would leave
 * members unable to find what they agreed to.
 */
const SITE_LINKS = [
  { href: "/pages/about", label: "About" },
  { href: "/pages/terms", label: "Terms" },
  { href: "/pages/policies", label: "Policies" },
  { href: "/pages/membership-terms", label: "Membership terms" },
  { href: "/pages/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

/*
 * The consent surface is Current's, and the heading and blurb shown are read
 * from it, so what the visitor sees is what the sign-up records
 * (decisions 6 Nov, 5).
 */
const SIGNUP = "grid_footer" as const;

export function ClassicFooter() {
  return (
    <footer data-part="site-footer">
      <a href="#main" data-part="site-footer-back-to-top">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 15 6-6 6 6" />
        </svg>
        Back to Top
      </a>

      <ClassicJoinBand />

      <div data-part="site-footer-main">
        <Image
          src="/logo-stacked.svg"
          alt="Sheet Metal Industries"
          width={819}
          height={270}
          data-part="site-footer-logo"
        />

        <div data-part="site-footer-signup">
          <h2 data-part="site-footer-heading">{SIGNUP_SURFACES[SIGNUP].heading}</h2>
          <p data-part="site-footer-blurb">{SIGNUP_SURFACES[SIGNUP].blurb}</p>
          <NewsletterSignup surface={SIGNUP} />
        </div>

        <ul data-part="site-footer-socials">
          {SOCIAL_CHANNELS.map((c) => (
            <li key={c.key}>
              <a href={SMI_SOCIAL_URLS[c.key]} target="_blank" rel="noopener" aria-label={c.label}>
                <SocialIcon channel={c.key} />
              </a>
            </li>
          ))}
        </ul>

        <nav aria-label="Footer" data-part="site-footer-links">
          <ul>
            {SITE_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
            <li><CookieSettingsLink /></li>
          </ul>
        </nav>

        <p data-part="site-footer-legal">
          © {new Date().getFullYear()} Sheet Metal Industries. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
