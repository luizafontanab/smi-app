"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* PROTOTYPE: live-site nav link — grey, white + orange underline when current. */
export function ClassicNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const on = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`border-b-2 py-1 text-[1.0625rem] ${on ? "border-brand text-white" : "border-transparent text-[#b4b4b4] hover:text-white"}`}
    >
      {children}
    </Link>
  );
}
