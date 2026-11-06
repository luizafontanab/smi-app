import Image from "next/image";
import Link from "next/link";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { SocialIcon } from "@/components/social-icons";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";

/*
 * PROTOTYPE (issue #59). The live site's closing run, every page:
 * Back to Top strip → orange "Become a Member." band → black centred footer.
 *
 * Departures from the live site, on purpose:
 *   · the band's text is ink on orange (7.4:1), not white (2.49:1, fails AA)
 *   · footer text is white/75, not #a5a5a5 — it passes on black either way,
 *     but the live grey is the same one that fails on white elsewhere, so the
 *     prototype keeps one rule: no #a5a5a5 anywhere
 *   · no advert carousel in the footer yet (live has one): left out of the
 *     prototype, flagged as an open question
 */
const LINKS = [
  { href: "/pages/about", label: "About" },
  { href: "/pages/policies", label: "Policies" },
  { href: "/pages/terms", label: "Terms" },
  { href: "/pages/membership-terms", label: "Membership terms" },
  { href: "/pages/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function ClassicFooter({ buttons }: { buttons: "blue" | "ink" }) {
  return (
    <>
      <a href="#main" className="flex flex-col items-center gap-1 bg-white py-4 text-base text-ink hover:text-[#3100ff]">
        <span aria-hidden="true">⌃</span>Back to Top
      </a>
      <section className="bg-brand px-4 py-16 text-center text-ink">
        <h2 className="text-4xl font-normal sm:text-5xl">Become a Member.</h2>
        <p className="mx-auto mt-3 max-w-xl text-lg">Get your company in front of the UK sheet metal trade: a directory listing, your news on the site, and more.</p>
        <Link
          href="/join"
          className={`mt-6 inline-block rounded-[5px] px-6 py-3 text-lg ${buttons === "blue" ? "bg-[#3100ff] text-white hover:bg-ink" : "bg-ink text-white hover:bg-[#22262c]"}`}
        >
          Become a Member
        </Link>
      </section>
      <footer className="bg-black px-4 py-16 text-center text-[0.9375rem] text-white/75">
        <Image src="/logo-stacked.svg" alt="Sheet Metal Industries" width={819} height={270} className="mx-auto h-16 w-auto" />
        <h2 className="mt-10 text-3xl font-normal text-brand">Sign up to our Newsletter</h2>
        <div className="mx-auto mt-4 max-w-md text-left">
          <NewsletterSignup surface="grid_footer" />
        </div>
        <div className="mt-10 flex justify-center gap-5">
          {SOCIAL_CHANNELS.map((c) => (
            <a key={c.key} href={SMI_SOCIAL_URLS[c.key]} aria-label={c.label} target="_blank" rel="noopener" className="hover:text-brand">
              <SocialIcon channel={c.key} className="h-5 w-5" />
            </a>
          ))}
        </div>
        <nav aria-label="Footer" className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-lg font-medium">
          {LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-brand">{l.label}</Link>)}
          <CookieSettingsLink />
        </nav>
        <p className="mt-8">© {new Date().getFullYear()} Sheet Metal Industries. All Rights Reserved.</p>
      </footer>
    </>
  );
}
