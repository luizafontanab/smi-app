import Link from "next/link";

/** Slim industry strip above the header. Data comes from the public layout — this stays presentational. */
export function IndustryBar({ industries }: { industries: { slug: string; name: string }[] }) {
  if (industries.length === 0) return null;
  return (
    <nav aria-label="Industries" className="border-b border-white/10 bg-chrome text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-x-1 overflow-x-auto px-4">
        <span className="hidden shrink-0 pr-2 text-[11px] uppercase tracking-wide text-white/50 sm:block">Industries</span>
        {industries.map((c) => (
          <Link
            key={c.slug}
            href={`/industry/${c.slug}`}
            className="tap shrink-0 whitespace-nowrap rounded px-2.5 py-1.5 text-xs text-white/70 hover:bg-chrome-hover hover:text-white"
          >
            {c.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}
