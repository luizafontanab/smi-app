import Link from "next/link";
import { Fragment } from "react";

/**
 * Slim industry strip. Data and position come from the public layout — this
 * stays presentational. Forge puts it above the header; grid puts it below the
 * header as a secondary nav, which is where the client's comps have it.
 *
 * `tone` follows the header it sits with: "dark" (the default) is forge's
 * near-black chrome; "grey" is the grid design's very light grey band
 * (bg-shade) under the light header — a secondary nav set apart from the page
 * without the weight of a dark strip.
 *
 * Jas's ten names (12 Oct 2026) are too long for one row at desktop width, so
 * from `lg` up the strip is two centred rows of roughly equal width, rather
 * than hiding the last few off-screen behind a scroll with no affordance. Two
 * don't fit on a tablet, so `md` gets three balanced rows instead of two plus
 * a straggler. The "Industries" label goes at those sizes: in front of the
 * first row it would push that row off centre, and the nav keeps its
 * aria-label. Phones keep the single scrolling row: ten wrapped names would
 * stack four or five lines deep.
 */
const TONES = {
  dark: {
    bar: "border-b border-white/10 bg-chrome text-white",
    label: "text-white/50",
    link: "text-white/70 hover:bg-chrome-hover hover:text-white",
  },
  grey: {
    bar: "border-b border-line bg-shade text-ink",
    label: "text-graphite",
    link: "text-graphite hover:bg-line hover:text-ink",
  },
} as const;

/**
 * Where to break the list into `rows` rows of roughly equal width, keeping its
 * order: each break goes where the running total of name length is closest to
 * its share of the whole. Names stand in for rendered width, which is close
 * enough at one font size. Returns the index each new row starts at.
 */
export function balancedBreaks(names: readonly string[], rows: number): number[] {
  const total = names.reduce((n, s) => n + s.length, 0);
  const breaks: number[] = [];
  let run = 0;
  let row = 1;
  for (let i = 0; i < names.length && row < rows; i++) {
    const target = (total * row) / rows;
    const next = run + names[i].length;
    // break before name i if stopping here lands nearer the target than taking it
    if (i > (breaks.at(-1) ?? 0) && Math.abs(run - target) <= Math.abs(next - target)) {
      breaks.push(i);
      row++;
    }
    run = next;
  }
  return breaks;
}

export function IndustryBar({ industries, tone = "dark" }: {
  industries: { slug: string; name: string }[];
  tone?: keyof typeof TONES;
}) {
  if (industries.length === 0) return null;
  const t = TONES[tone];
  const names = industries.map((c) => c.name);
  const twoRows = new Set(balancedBreaks(names, 2));
  const threeRows = new Set(balancedBreaks(names, 3));
  return (
    <nav aria-label="Industries" className={t.bar}>
      <div className="mx-auto flex max-w-6xl items-center gap-x-1 overflow-x-auto px-4 md:flex-wrap md:justify-center md:overflow-visible md:py-0.5">
        <span className={`hidden shrink-0 pr-2 text-[11px] uppercase tracking-wide sm:block md:hidden ${t.label}`}>Industries</span>
        {industries.map((c, i) => (
          <Fragment key={c.slug}>
            {/* Zero-height full-width items: the row breaks — three rows on a
                tablet, two from lg up, none on a phone. */}
            {threeRows.has(i) && <span aria-hidden className="hidden basis-full md:block lg:hidden" />}
            {twoRows.has(i) && <span aria-hidden className="hidden basis-full lg:block" />}
            <Link
              href={`/industry/${c.slug}`}
              className={`tap shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs ${t.link}`}
            >
              {c.name}
            </Link>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
