"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; muted?: boolean };

function isActive(pathname: string, href: string) {
  return href === "/console" ? pathname === "/console" : pathname === href || pathname.startsWith(`${href}/`);
}

// The console's one shell — a horizontal top bar. Muted items are the modules
// built beyond the wireframe, still reachable but visually de-emphasised.
export function ConsoleNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto px-4 text-sm">
      {items.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 ${
              active
                ? "border-brand bg-chrome-hover font-semibold text-white"
                : `border-transparent hover:bg-chrome-hover ${n.muted ? "text-white/50" : "text-white/80"}`
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
