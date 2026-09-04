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
export function AccountMenu({ name, links, signOutAction }: {
  name: string;
  links: { href: string; label: string }[];
  signOutAction: () => Promise<void>;
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
        aria-label={`Account: ${name}`}
        title={name}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full bg-brand p-2 text-ink hover:brightness-110"
      >
        <IconAccount width={20} height={20} strokeWidth={2} />
      </button>
      <div
        className={`absolute right-0 z-20 w-48 rounded-b bg-chrome py-1 text-white shadow-lg transition ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <p className="truncate border-b border-white/10 px-4 py-2 text-xs text-white/60">{name}</p>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block px-4 py-2 hover:bg-chrome-hover" onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
        <form action={signOutAction}>
          <button type="submit" className="block w-full px-4 py-2 text-left hover:bg-chrome-hover">Sign out</button>
        </form>
      </div>
    </div>
  );
}
