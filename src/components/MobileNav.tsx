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
  // The header's Members dropdown, flattened like the Media one above.
  { href: "/member", label: "Find a member" },
  { href: "/join", label: "Join" },
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
export function MobileNav({ user, accountLinks = [], signOutAction }: {
  user: CurrentUser | null;
  accountLinks?: { href: string; label: string; badge?: number }[];
  signOutAction?: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
              <>
                <p className="truncate px-3 text-xs text-white/60">{name}</p>
                {accountLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={close}
                    aria-label={l.badge ? `${l.label}, ${l.badge} unread` : undefined}
                    className="flex items-center justify-between gap-2 rounded px-3 py-2.5 hover:bg-chrome-hover"
                  >
                    <span>{l.label}</span>
                    {Boolean(l.badge) && (
                      <span aria-hidden="true" className="min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-bold leading-5 text-ink">
                        {l.badge}
                      </span>
                    )}
                  </Link>
                ))}
                {signOutAction && (
                  <form action={signOutAction}>
                    <button type="submit" className="block w-full rounded px-3 py-2.5 text-left hover:bg-chrome-hover">Sign out</button>
                  </form>
                )}
              </>
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
