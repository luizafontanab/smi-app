import Link from "next/link";

/**
 * Catches notFound() from the public content routes — news/[slug],
 * members/[slug], pages/[slug]. On a site migrating off WordPress, 404s from
 * stale inbound links are the expected case, not the exceptional one, so this
 * offers the two routes back in (search, news index) rather than a dead end.
 *
 * The (public) layout supplies header, footer and consent banner.
 */
export default function PublicNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-4 text-gray-600">
        The link may be out of date, or the story may have moved. Our archive goes back a long way —
        searching for the company or headline is usually the quickest way to find it.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/search" className="rounded bg-ink px-4 py-2 font-semibold text-white hover:brightness-110">
          Search the archive
        </Link>
        <Link href="/news" className="rounded border border-ink px-4 py-2 font-semibold text-ink hover:bg-ink/5">
          Latest news
        </Link>
        <Link href="/member" className="rounded border border-ink px-4 py-2 font-semibold text-ink hover:bg-ink/5">
          Member directory
        </Link>
      </div>
    </div>
  );
}
