import Link from "next/link";

/** Shared Prev/Next nav — mirrors the pattern /news pioneered. */
export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="my-8 flex items-center justify-center gap-2 text-sm">
      {page > 1 && <Link href={hrefFor(page - 1)} className="tap rounded border bg-white px-3 py-1.5">← Prev</Link>}
      <span className="px-2 text-graphite">Page {page} of {pages}</span>
      {page < pages && <Link href={hrefFor(page + 1)} className="tap rounded border bg-white px-3 py-1.5">Next →</Link>}
    </nav>
  );
}
