"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string };
export type NavSection = {
  key: string; href: string; label: string; children?: NavItem[];
  /**
   * Extra path prefixes that belong to a childless section — e.g. the member
   * area's "Add content" points at the Story form but owns the Video, Event
   * and Equipment forms too (#33 M20).
   */
  match?: string[];
};

function isActive(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

/** Length of the longest of this section's paths that matches, or -1. */
function sectionMatch(pathname: string, section: NavSection, root: string) {
  const paths = section.children ? section.children.map((c) => c.href) : [section.href, ...(section.match ?? [])];
  return paths.reduce((best, href) => (isActive(pathname, href, root) && href.length > best ? href.length : best), -1);
}

/**
 * The section that owns the path — the most specific match wins, so a broad
 * `match` prefix (all of /dashboard/story for "Your content") gives way to a
 * narrower one (/dashboard/story/new for "Add content"). Ties keep list order.
 */
export function activeSectionFor(pathname: string, items: NavSection[], root: string): NavSection | undefined {
  let found: NavSection | undefined;
  let bestLength = -1;
  for (const s of items) {
    const length = sectionMatch(pathname, s, root);
    if (length > bestLength) { found = s; bestLength = length; }
  }
  return found;
}

const TONES = {
  // The console's near-black bar.
  dark: {
    active: "border-brand bg-chrome-hover font-semibold text-white",
    idle: "border-transparent text-white/80 hover:bg-chrome-hover",
  },
  // The member area's light header (#33 H14).
  light: {
    active: "border-brand font-semibold text-ink",
    idle: "border-transparent text-graphite hover:bg-shade hover:text-ink",
  },
};

// The console's shell — a two-row bar. Row 1 is high-level sections; row 2 is
// always rendered but only populated with the active section's children, so
// it reads as a persistent sub-menu rather than a dropdown that disappears.
// The member area reuses it with root="/dashboard" and a flat section list —
// with no children anywhere, the sub-row is dropped rather than left empty.
export function ConsoleNav({ items, root = "/console", tone = "dark" }: {
  items: NavSection[];
  root?: string;
  /** The header surface the strip sits on. */
  tone?: "dark" | "light";
}) {
  const pathname = usePathname();
  const activeSection = activeSectionFor(pathname, items, root);
  const children = activeSection?.children ?? [];
  // Only the most specific match lights up. Bookings is /console/adverts, a
  // prefix of every other Adverts page, so a plain prefix test kept it
  // highlighted beside whichever page was actually open. A booking's own page
  // (/console/adverts/<id>) matches nothing longer, so it still lights Bookings.
  const activeChild = children
    .filter((n) => isActive(pathname, n.href, root))
    .reduce<NavItem | null>((best, n) => (!best || n.href.length > best.href.length ? n : best), null);
  const hasSubRow = items.some((s) => s.children);
  const colors = TONES[tone];

  // #33 M1: on a phone most of the strip is off-screen. Scroll the current
  // section into view on every navigation (so "where am I" is always
  // visible), and fade whichever edge has more tabs behind it, so the strip
  // reads as scrollable.
  const stripRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () => setMore({
      left: strip.scrollLeft > 1,
      right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
    });
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && strip.scrollWidth > strip.clientWidth) {
      // Centre it by hand: scrollIntoView would also scroll the page vertically.
      strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    }
    update();
    strip.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      strip.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);
  const fade = (side: boolean) => (side ? "transparent 0, #000 2.5rem" : "#000 0");
  const mask = more.left || more.right
    ? `linear-gradient(to right, ${fade(more.left)}, ${more.right ? "#000 calc(100% - 2.5rem), transparent 100%" : "#000 100%"})`
    : undefined;

  return (
    <div>
      <nav
        ref={stripRef}
        aria-label="Console sections"
        className="relative flex items-center gap-1 overflow-x-auto px-4 text-sm"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {items.map((s) => {
          const active = s === activeSection;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`tap shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 ${active ? colors.active : colors.idle}`}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      {hasSubRow && <nav aria-label="Section pages" className="flex min-h-[2.25rem] items-center gap-1 overflow-x-auto border-t border-white/10 bg-chrome-hover/40 px-4 text-xs">
        {children.map((n) => {
          const active = n === activeChild;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded px-3 py-2 ${
                active ? "bg-white/15 font-semibold text-white" : "text-white/75 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>}
    </div>
  );
}
