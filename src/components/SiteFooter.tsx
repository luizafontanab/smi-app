import Link from "next/link";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { NewsletterSignup } from "./NewsletterSignup";

export function SiteFooter() {
  return (
    <footer className="mt-12 bg-chrome text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <p className="text-lg font-bold">Sheet Metal <span className="text-amber">Industries</span></p>
          <p className="mt-2 text-sm text-white/70">The voice of the UK sheet metal, fabrication and welding trade.</p>
          <div className="mt-4 flex gap-3 text-xs text-white/70">
            {SOCIAL_CHANNELS.map((c) => (
              <a key={c.key} href={SMI_SOCIAL_URLS[c.key]} target="_blank" rel="noopener" aria-label={c.label} className="hover:text-amber">{c.label}</a>
            ))}
          </div>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Site</p>
          <ul className="space-y-1 text-white/80">
            <li><Link href="/pages/about" className="hover:text-amber">About</Link></li>
            <li><Link href="/pages/policies" className="hover:text-amber">Policies</Link></li>
            <li><Link href="/contact" className="hover:text-amber">Contact</Link></li>
            <li><Link href="/advertising" className="hover:text-amber">Advertising</Link></li>
            <li><Link href="/members" className="hover:text-amber">Find a Member</Link></li>
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
