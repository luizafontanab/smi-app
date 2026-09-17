"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { IconAccount } from "@/components/icons";

/**
 * The signed-in account dropdown in the public header — same interaction
 * contract as MediaMenu: click toggles, Escape closes and refocuses the
 * trigger, focus leaving the widget closes it, and aria-expanded always
 * matches what's on screen. The trigger is icon-only, so it carries an
 * explicit accessible name.
 */
export function AccountMenu({ name, links, signOutAction, unread = 0 }: {
  name: string;
  /** `badge` puts a count pill on that entry — the notifications link uses it. */
  links: { href: string; label: string; badge?: number }[];
  signOutAction: () => Promise<void>;
  /** Unread notifications, badged on the trigger. 0 renders nothing. */
  unread?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={wrapper}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        // The count belongs in the accessible name, not only in the visual
        // badge — same treatment as the console header's messages bell.
        aria-label={unread > 0 ? `Account: ${name}, ${unread} unread notifications` : `Account: ${name}`}
        title={name}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full bg-brand p-2 text-ink hover:brightness-110"
      >
        <IconAccount width={20} height={20} strokeWidth={2} />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ink px-1 text-center text-xs font-bold leading-4 text-white">
            {unread}
          </span>
        )}
      </button>
      <div
        className={`absolute right-0 z-20 w-48 rounded-b bg-chrome py-1 text-white shadow-lg transition ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <p className="truncate border-b border-white/10 px-4 py-2 text-xs text-white/60">{name}</p>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            // A bare "3" beside the label would be read out as part of the link
            // text with no indication of what it counts, so the count goes in
            // the accessible name and the pill itself is decorative.
            aria-label={l.badge ? `${l.label}, ${l.badge} unread` : undefined}
            className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-chrome-hover"
            onClick={() => setOpen(false)}
          >
            <span>{l.label}</span>
            {Boolean(l.badge) && (
              <span aria-hidden="true" className="min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-bold leading-5 text-ink">
                {l.badge}
              </span>
            )}
          </Link>
        ))}
        <form action={signOutAction}>
          <button type="submit" className="block w-full px-4 py-2 text-left hover:bg-chrome-hover">Sign out</button>
        </form>
      </div>
    </div>
  );
}
