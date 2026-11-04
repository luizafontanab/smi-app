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

/** Same stroke family as components/icons.tsx (1.75, round) — the drawn set. */
function Glyph({ d }: { d: string }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * Off-canvas menu for <lg viewports, where SiteHeader's desktop links are
 * hidden and its Media dropdown relies on :hover (unreliable on touch). Built
 * on the platform <dialog> element — same choice as DevTaskWidget.tsx, for
 * the same reason: focus trap, Escape-to-close and an inert background for
 * free, and the top layer sidesteps a z-index fight with CookieConsent (z-50).
 *
 * The drawer is light — white with ink text — on both designs (#33): grid's
 * header is white and a near-black panel under it read as heavy, and the
 * orange CTA and ink text pass AA on white either way.
 */
export function MobileNav({ user, accountLinks = [], signOutAction, triggerClassName = "hover:bg-chrome-hover" }: {
  user: CurrentUser | null;
  accountLinks?: { href: string; label: string; badge?: number }[];
  signOutAction?: () => Promise<void>;
  /**
   * Hover treatment for the trigger, which inherits its header's foreground.
   * The default suits the near-black chrome header; the grid design's light
   * header passes a light hover, because chrome-hover there would paint a
   * near-black block behind ink-coloured text. The drawer has its own light
   * palette regardless.
   */
  triggerClassName?: string;
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

  // Every row 44px tall (16px text, 24px line, 10px padding each way) — the
  // lower links used to inherit the header's 14px and come up short (#33).
  const row = "rounded px-3 py-2.5 hover:bg-shade";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label="Open menu"
        // 44×44 on every pointer: it is the only way into the nav on a phone.
        className={`-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded lg:hidden ${triggerClassName}`}
      >
        <Glyph d="M4 7h16M4 12h16M4 17h16" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Site menu"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        onClose={() => triggerRef.current?.focus()}
        // max-h-none: the UA's modal max-height otherwise stops the drawer
        // short of the screen bottom (#33).
        className="m-0 ml-auto h-full max-h-none w-[min(20rem,85vw)] max-w-none border-0 bg-white p-0 text-base text-ink shadow-lg backdrop:bg-black/40"
      >
        <nav className="flex min-h-full flex-col px-4 pb-4">
          {/* Sticky, so a long signed-in list can't scroll the close button away. */}
          <div className="sticky top-0 -mx-4 flex justify-end bg-white px-4 pt-4 pb-2">
            <button type="button" onClick={close} aria-label="Close menu" className="inline-flex size-11 items-center justify-center rounded hover:bg-shade">
              <Glyph d="M6 6l12 12M18 6 6 18" />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className={`block ${row}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-line pt-4">
            <Link href="/search" onClick={close} className={`block ${row}`}>
              Search
            </Link>
          </div>
          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
            {user ? (
              <>
                <p className="truncate px-3 text-xs text-graphite">{name}</p>
                {accountLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={close}
                    aria-label={l.badge ? `${l.label}, ${l.badge} unread` : undefined}
                    className={`flex items-center justify-between gap-2 ${row}`}
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
                    <button type="submit" className={`block w-full text-left ${row}`}>Sign out</button>
                  </form>
                )}
              </>
            ) : (
              <>
                <Link href="/join" onClick={close} className="rounded bg-brand px-3 py-2.5 text-center font-semibold text-ink hover:brightness-110">
                  Become a Member
                </Link>
                <Link href="/dashboard" onClick={close} className="rounded border border-graphite/30 px-3 py-2.5 text-center hover:bg-shade">
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
