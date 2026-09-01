"use client";

import { useRef } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";

const LINKS = [
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/pages/mach-publication", label: "Magazine" },
  { href: "/advertising", label: "Advertising" },
  { href: "/member", label: "Members" },
  { href: "/featured-machine", label: "Featured Machine" },
  { href: "/event", label: "Events" },
];

/**
 * Off-canvas menu for <lg viewports, where SiteHeader's desktop links are
 * hidden and its Media dropdown relies on :hover (unreliable on touch). Built
 * on the platform <dialog> element — same choice as DevTaskWidget.tsx, for
 * the same reason: focus trap, Escape-to-close and an inert background for
 * free, and the top layer sidesteps a z-index fight with CookieConsent (z-50).
 */
export function MobileNav({ user }: { user: CurrentUser | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dashboard = user?.role === "member" ? "/dashboard" : "/console";
  const name = user ? user.displayName ?? user.email : "";

  function open() {
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label="Open menu"
        className="rounded px-3 py-2 hover:bg-chrome-hover lg:hidden"
      >
        ☰
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Site menu"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-0 ml-auto h-full w-[min(20rem,85vw)] max-w-none border-0 bg-chrome p-0 text-white shadow-lg backdrop:bg-black/40"
      >
        <nav className="flex h-full flex-col p-4">
          <button type="button" onClick={close} aria-label="Close menu" className="self-end rounded px-3 py-2 hover:bg-chrome-hover">
            ✕
          </button>
          <ul className="mt-2 flex flex-col gap-1 text-base">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className="block rounded px-3 py-2.5 hover:bg-chrome-hover">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-white/10 pt-4">
            <Link href="/search" onClick={close} className="block rounded px-3 py-2.5 hover:bg-chrome-hover">
              Search
            </Link>
          </div>
          <div className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-4">
            {user ? (
              <Link href={dashboard} onClick={close} title={name} className="truncate rounded bg-brand px-3 py-2.5 text-center font-semibold text-ink">
                {name}
              </Link>
            ) : (
              <>
                <Link href="/join" onClick={close} className="rounded bg-brand px-3 py-2.5 text-center font-semibold text-ink">
                  Become a Member
                </Link>
                <Link href="/dashboard" onClick={close} className="rounded border border-white/30 px-3 py-2.5 text-center">
                  Login
                </Link>
              </>
            )}
          </div>
        </nav>
      </dialog>
    </>
  );
}
