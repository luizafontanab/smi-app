import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Under construction",
  robots: { index: false, follow: false },
};

/**
 * Holding page. Every URL is rewritten here by src/proxy.ts while the site is
 * not live, so this is the only page anyone can reach — hence no links, which
 * would all lead straight back here.
 *
 * Sits outside the (public) group deliberately: the only wrapper is RootLayout,
 * so no header, footer, cookie consent or database access. Like not-found.tsx,
 * this is a page that has to work when nothing else does.
 */
export default function UnderConstruction() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="bg-chrome px-4 py-3 text-white">
        <span className="text-lg font-bold tracking-tight">
          Sheet Metal <span className="text-brand">Industries</span>
        </span>
      </header>
      <main id="main" className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-4 py-20 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Under construction</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">We&apos;ll be back soon</h1>
        <p className="mt-4 text-gray-600">
          Our new site is being built. Thank you for your patience.
        </p>
      </main>
    </div>
  );
}
