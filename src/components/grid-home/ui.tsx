import Link from "next/link";
import type { SVGProps } from "react";

/**
 * Primitives for the grid design's homepage, taken from the client's designer
 * comps (docs/Sheet Metal Industries Home v1.png / v2.png). They live under
 * components/grid-home/ rather than beside the page because a folder inside
 * src/app/(public)/ would become a route segment.
 *
 * The comps' house style, in one place so the page module stays composition:
 *   · solid orange chips as section heads, small orange eyebrows inside cards
 *   · flat white cards, hairline border, near-square corners — no shadows
 *   · uppercase League Spartan headings (the --font-heading role)
 *   · square solid buttons: ink for in-card actions, orange for the join CTA
 *
 * CONTRAST: the comps set white on orange and #ff8200 on white, both 2.5:1 and
 * both failing AA at any size (the measured table at the top of globals.css).
 * Everything here uses the two pairings that pass instead — ink on orange
 * (7.4:1) for chips and buttons, --smi-brand-text #9d5000 for small orange
 * labels on white. Same orange, same shapes; the type is a shade deeper.
 * tests/e2e/a11y.spec.ts runs axe against this page, so this is load-bearing.
 */

/** Section head: the comps' solid orange label ("LATEST VIDEOS", "MORE NEWS"). */
export function Chip({ children, as = "h2" }: { children: React.ReactNode; as?: "h2" | "p" }) {
  const Tag = as;
  return (
    <Tag data-part="section-title" className="inline-block bg-brand px-2.5 py-1 font-sans text-xs font-extrabold sm:text-[11px] uppercase tracking-[0.12em] text-ink">
      {children}
    </Tag>
  );
}

/**
 * The small orange category label above a card's headline. Labels and meta
 * step up to 12px below sm (#33 C4) — 11px on a full-width phone card was the
 * "text seems small" complaint.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p data-part="card-eyebrow" className="text-xs sm:text-[11px] font-bold uppercase tracking-[0.1em] text-brand-text">{children}</p>;
}

/**
 * Flat white card — hairline border, near-square corners, no shadow.
 *
 * `border` is its own prop rather than something to pass through className:
 * both are border-colour utilities of equal specificity, so which one won
 * would come down to Tailwind's output order, not the order they are written
 * in. The placement cards on the fold pass the warm one.
 */
export function Panel({ children, className = "", border = "border-line", part = "panel" }: {
  children: React.ReactNode;
  className?: string;
  border?: "border-line" | "border-brand/50";
  /** Its data-part label (design-option.ts): "panel", or the card kind a card passes. */
  part?: string;
}) {
  return (
    <div data-part={part} className={`rounded-[var(--gh-radius)] border ${border} bg-white ${className}`}>{children}</div>
  );
}

const BAND_TONES = {
  plain: "",
  grey: "bg-[var(--gh-band)]",
  dark: "bg-ink text-white",
} as const;

/**
 * A full-bleed section with a contained inner column — the comps separate
 * sections with edge-to-edge grey and near-black bands rather than rules.
 * `.gh` sets no max-width, so a section inside it is already page-wide.
 */
export function Band({ tone = "plain", className = "", inner = "", part = "home-band", children }: {
  tone?: keyof typeof BAND_TONES;
  className?: string;
  /** Extra classes for the contained column (padding, grid). */
  inner?: string;
  /** Its data-part label (design-option.ts). Advert bands pass "home-band-ad". */
  part?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-part={part} className={`${BAND_TONES[tone]} ${className}`}>
      <div className={`mx-auto max-w-6xl px-4 ${inner}`}>{children}</div>
    </section>
  );
}

const BTN_BASE = "inline-block rounded-[var(--gh-radius)] px-5 py-2.5 text-sm font-bold";

/** The comps' black in-card action ("Read more", "View all events"). */
export function BtnDark({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} data-part="button-primary" className={`${BTN_BASE} bg-ink text-white hover:bg-chrome-hover`}>{children}</Link>;
}

/** The comps' orange membership CTA. Ink on orange — never white (see note above). */
export function BtnBrand({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} data-part="join-button" className={`${BTN_BASE} bg-brand text-ink hover:brightness-110`}>{children}</Link>;
}

/** "More →" link in a section head, beside a Chip. */
export function MoreLink({ href, children = "See all" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} data-part="see-all" className="tap shrink-0 text-xs font-semibold text-brand-text hover:underline">
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Chip on the left, optional "see all" on the right — the comps' section head row. */
export function SectionHead({ title, href, seeAll }: { title: string; href?: string; seeAll?: string }) {
  return (
    <div data-part="section-head" className="mb-4 flex items-center justify-between gap-4">
      <Chip>{title}</Chip>
      {href && <MoreLink href={href}>{seeAll}</MoreLink>}
    </div>
  );
}

function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function IconPerson(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  );
}

/**
 * The comps' orange icon + label meta line. `date` is an ISO string; it is
 * formatted en-GB here so every card on the page agrees on one format.
 * Publication dates are timestamps, so no UTC pinning — unlike event dates,
 * which are plain date columns and are formatted by lib/cards.tsx in UTC.
 */
export function Meta({ date, by, className = "" }: { date?: string | null; by?: string | null; className?: string }) {
  if (!date && !by) return null;
  return (
    <div data-part="card-meta" className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-brand-text sm:text-[11px] ${className}`}>
      {by && (
        <span className="inline-flex items-center gap-1.5">
          <IconPerson width={13} height={13} />
          Published by {by}
        </span>
      )}
      {date && (
        <span className="inline-flex items-center gap-1.5">
          <IconCalendar width={13} height={13} />
          {new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}
        </span>
      )}
    </div>
  );
}

/** Uppercase card headline in the display face — the comps' dominant text shape. */
export function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 data-part="card-title" className={`font-heading font-extrabold uppercase leading-[1.15] ${className}`}>{children}</h3>
  );
}
