import Link from "next/link";
// Loads the design option's stylesheet: this page sits outside the public
// layout but is part of the public site (data-site="public" below).
import "@/components/design-option";

/**
 * Root 404 — URLs that match no route at all, so no route group's layout
 * applies and the only wrapper is RootLayout (html/body, no site chrome).
 * Content routes get the richer (public)/not-found.tsx instead.
 *
 * Deliberately touches no database: this is the page that has to work when
 * something else did not.
 */
export default function NotFound() {
  return (
    <div data-site="public" data-part="not-found" className="flex min-h-screen flex-col bg-paper">
      <header data-part="not-found-header" className="bg-chrome px-4 py-3 text-white">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Sheet Metal <span className="text-brand">Industries</span>
        </Link>
      </header>
      <main id="main" className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-4 py-20 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-text">404</p>
        <h1 data-part="page-title" className="mt-2 text-3xl font-bold text-ink">That page doesn&apos;t exist</h1>
        <p className="mt-4 text-graphite">
          The address may be mistyped, or the page may have been removed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" data-part="button-primary" className="rounded bg-ink px-4 py-2 font-semibold text-white hover:brightness-110">
            Back to the homepage
          </Link>
          <Link href="/search" data-part="button-secondary" className="rounded border border-ink px-4 py-2 font-semibold text-ink hover:bg-ink/5">
            Search the archive
          </Link>
        </div>
      </main>
    </div>
  );
}
