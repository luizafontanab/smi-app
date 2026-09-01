import Link from "next/link";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { CookieSettingsLink } from "./CookieSettingsLink";
import { NewsletterSignup } from "./NewsletterSignup";

export function SiteFooter() {
  return (
    <footer className="mt-12 bg-chrome text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <p className="font-logo text-lg">Sheet Metal <span className="text-brand">Industries</span></p>
          <p className="mt-2 text-sm text-white/70">The voice of the UK sheet metal, fabrication and welding trade.</p>
          <div className="mt-4 flex gap-3 text-xs text-white/70">
            {SOCIAL_CHANNELS.map((c) => (
              <a key={c.key} href={SMI_SOCIAL_URLS[c.key]} target="_blank" rel="noopener" aria-label={c.label} className="hover:text-brand">{c.label}</a>
            ))}
          </div>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Site</p>
          <ul className="space-y-1 text-white/80">
            <li><Link href="/pages/about" className="hover:text-brand">About</Link></li>
            <li><Link href="/pages/policies" className="hover:text-brand">Policies</Link></li>
            <li><Link href="/contact" className="hover:text-brand">Contact</Link></li>
            <li><Link href="/advertising" className="hover:text-brand">Advertising</Link></li>
            <li><Link href="/member" className="hover:text-brand">Find a Member</Link></li>
            <li><Link href="/event" className="hover:text-brand">Events</Link></li>
            <li><Link href="/featured-machine" className="hover:text-brand">Featured Machine</Link></li>
            <li><CookieSettingsLink /></li>
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Monthly newsletter</p>
          <NewsletterSignup />
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">
        © {new Date().getFullYear()} Sheet Metal Industries. All rights reserved.
      </div>
    </footer>
  );
}
