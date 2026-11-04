"use client";
import Link from "next/link";
import { useRef, useState } from "react";

/**
 * A desktop header dropdown (originally just "Media", now parameterized so
 * "Members" can share it). CSS hover/focus-within alone left the trigger
 * button a no-op — no `aria-expanded`, nothing on Enter/Space, no Escape —
 * so keyboard and screen-reader users had a popup button that never visibly
 * popped. Click toggles it, Escape closes and returns focus to the trigger,
 * and focus leaving the widget closes it. Hover also goes through the same
 * state (not a CSS :hover class) so aria-expanded always matches what's on
 * screen.
 *
 * `className` carries the caller's responsive-visibility classes (e.g.
 * "hidden lg:block") so each dropdown keeps the breakpoint its plain-link
 * predecessor had; `relative` stays baked in for the popup's positioning.
 *
 * `tone` follows the header it sits in, as IndustryBar's does: "dark" is
 * forge's near-black chrome, "light" the grid design's white bar, where a
 * chrome-coloured popup would read as a stray black box.
 */
const TONES = {
  dark: { trigger: "hover:bg-chrome-hover", popup: "bg-chrome", link: "hover:bg-chrome-hover" },
  light: { trigger: "hover:bg-shade", popup: "border border-line bg-white text-ink", link: "hover:bg-shade" },
} as const;

export function MediaMenu({ label, items, className = "hidden lg:block", align = "left-0", tone = "dark" }: {
  label: string;
  items: { href: string; label: string }[];
  className?: string;
  /** Which edge the popup hangs from — a menu near the bar's right end opens leftward so it stays on screen. */
  align?: string;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={wrapper}
      className={`relative ${className}`}
      // Mouse only: a tap fires compatibility mouseenter *then* click, so a
      // touch-driven enter opened the menu and the click's toggle shut it
      // again straight away (#33, now that tablets get this menu at md).
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}
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
        onClick={() => setOpen((v) => !v)}
        className={`tap whitespace-nowrap rounded px-3 py-2 ${t.trigger}`}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      <div
        className={`absolute ${align} z-20 w-44 rounded-b py-1 shadow-lg transition ${t.popup} ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={`block px-4 py-2 [@media(pointer:coarse)]:py-3 ${t.link}`} onClick={() => setOpen(false)}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
