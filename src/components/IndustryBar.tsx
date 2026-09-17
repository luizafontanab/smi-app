import Link from "next/link";

/**
 * Slim industry strip above the header. Data comes from the public layout —
 * this stays presentational.
 *
 * `tone` follows the header it sits above: "dark" (the default) is forge's
 * near-black chrome; "light" is the grid design's light header, where a
 * near-black strip would read as a stray band above the page.
 */
const TONES = {
  dark: {
    bar: "border-b border-white/10 bg-chrome text-white",
    label: "text-white/50",
    link: "text-white/70 hover:bg-chrome-hover hover:text-white",
  },
  light: {
    bar: "border-b border-line bg-white text-ink",
    label: "text-graphite",
    link: "text-graphite hover:bg-shade hover:text-ink",
  },
} as const;

export function IndustryBar({ industries, tone = "dark" }: {
  industries: { slug: string; name: string }[];
  tone?: keyof typeof TONES;
}) {
  if (industries.length === 0) return null;
  const t = TONES[tone];
  return (
    <nav aria-label="Industries" className={t.bar}>
      <div className="mx-auto flex max-w-6xl items-center gap-x-1 overflow-x-auto px-4">
        <span className={`hidden shrink-0 pr-2 text-[11px] uppercase tracking-wide sm:block ${t.label}`}>Industries</span>
        {industries.map((c) => (
          <Link
            key={c.slug}
            href={`/industry/${c.slug}`}
            className={`tap shrink-0 whitespace-nowrap rounded px-2.5 py-1.5 text-xs ${t.link}`}
          >
            {c.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}
