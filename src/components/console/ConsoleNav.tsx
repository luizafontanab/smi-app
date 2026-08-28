"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };
export type NavSection = { key: string; href: string; label: string; children?: NavItem[] };

function isActive(pathname: string, href: string) {
  return href === "/console" ? pathname === "/console" : pathname === href || pathname.startsWith(`${href}/`);
}

function isSectionActive(pathname: string, section: NavSection) {
  if (section.children) return section.children.some((c) => isActive(pathname, c.href));
  return isActive(pathname, section.href);
}

// The console's shell — a two-row bar. Row 1 is high-level sections; row 2 is
// always rendered but only populated with the active section's children, so
// it reads as a persistent sub-menu rather than a dropdown that disappears.
export function ConsoleNav({ items }: { items: NavSection[] }) {
  const pathname = usePathname();
  const activeSection = items.find((s) => isSectionActive(pathname, s));
  const children = activeSection?.children ?? [];

  return (
    <div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 text-sm">
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
      <nav className="flex min-h-[2.25rem] items-center gap-1 overflow-x-auto border-t border-white/10 bg-chrome-hover/40 px-4 text-xs">
        {children.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded px-2.5 py-1.5 ${
                active ? "bg-white/15 font-semibold text-white" : "text-white/60 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
