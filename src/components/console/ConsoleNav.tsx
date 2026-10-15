"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };
export type NavSection = { key: string; href: string; label: string; children?: NavItem[] };

function isActive(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

function isSectionActive(pathname: string, section: NavSection, root: string) {
  if (section.children) return section.children.some((c) => isActive(pathname, c.href, root));
  return isActive(pathname, section.href, root);
}

// The console's shell — a two-row bar. Row 1 is high-level sections; row 2 is
// always rendered but only populated with the active section's children, so
// it reads as a persistent sub-menu rather than a dropdown that disappears.
// The member area reuses it with root="/dashboard" and a flat section list —
// with no children anywhere, the sub-row is dropped rather than left empty.
export function ConsoleNav({ items, root = "/console" }: { items: NavSection[]; root?: string }) {
  const pathname = usePathname();
  const activeSection = items.find((s) => isSectionActive(pathname, s, root));
  const children = activeSection?.children ?? [];
  // Only the most specific match lights up. Bookings is /console/adverts, a
  // prefix of every other Adverts page, so a plain prefix test kept it
  // highlighted beside whichever page was actually open. A booking's own page
  // (/console/adverts/<id>) matches nothing longer, so it still lights Bookings.
  const activeChild = children
    .filter((n) => isActive(pathname, n.href, root))
    .reduce<NavItem | null>((best, n) => (!best || n.href.length > best.href.length ? n : best), null);
  const hasSubRow = items.some((s) => s.children);

  return (
    <div>
      <nav aria-label="Console sections" className="flex items-center gap-1 overflow-x-auto px-4 text-sm">
        {items.map((s) => {
          const active = s === activeSection;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 ${
                active
                  ? "border-brand bg-chrome-hover font-semibold text-white"
                  : "border-transparent text-white/80 hover:bg-chrome-hover"
              }`}
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
