"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The live site's flat menu, in its order (spec #68, #71). No drop-downs. */
export const CLASSIC_MENU = [
  { href: "/", label: "Home" },
  { href: "/advertising", label: "Advertising" },
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/member", label: "Members" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/featured-machine", label: "Featured Machine" },
  { href: "/event", label: "Events" },
  { href: "/pages/mach-publication", label: "Magazine" },
] as const;

/**
 * Is `href` the section `path` sits in? An exact match, or a match by whole
 * path segment, so `/news/x` is in News but `/newsletters/x` is not (the
 * prototype's bare startsWith lit News up there). Home matches only itself.
 */
export function inSection(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

/**
 * Classic's flat menu. A client component only for usePathname, so the header
 * around it stays a server component and needs no path prop.
 * The current section gets aria-current: "page" on the section's own page,
 * "true" on a page inside it. classic.css draws the orange underline from it.
 */
export function ClassicMenu() {
  const path = usePathname();
  return (
    <ul data-part="site-menu">
      {CLASSIC_MENU.map((l) => {
        const current = path === l.href ? "page" : inSection(path, l.href) ? "true" : undefined;
        return (
          <li key={l.href}>
            <Link href={l.href} data-part="site-nav-link" aria-current={current}>
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
