"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; muted?: boolean };

function isActive(pathname: string, href: string) {
  return href === "/console" ? pathname === "/console" : pathname === href || pathname.startsWith(`${href}/`);
}

// Shared by both console shells: vertical for the sidebar, horizontal for the
// demo-theme top bar. Muted items are the modules built beyond the wireframe.
export function ConsoleNav({ items, orientation }: { items: NavItem[]; orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();

  if (orientation === "horizontal") {
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
                  ? "border-amber bg-chrome-hover font-semibold text-white"
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

  return (
    <nav className="flex flex-col text-sm">
      {items.map((n, i) => {
        const active = isActive(pathname, n.href);
        const firstMuted = n.muted && !items[i - 1]?.muted;
        return (
          <Fragment key={n.href}>
            {firstMuted && <div className="mx-4 my-2 border-t border-white/10" />}
            <Link
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`border-l-2 px-4 py-2.5 ${
                active
                  ? "border-amber bg-chrome-hover font-semibold text-white"
                  : `border-transparent hover:bg-chrome-hover ${n.muted ? "text-white/50" : ""}`
              }`}
            >
              {n.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
