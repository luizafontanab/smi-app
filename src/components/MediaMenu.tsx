"use client";
import Link from "next/link";
import { useRef, useState } from "react";

/**
 * The desktop header's Media dropdown. CSS hover/focus-within alone left the
 * trigger button a no-op — no `aria-expanded`, nothing on Enter/Space, no
 * Escape — so keyboard and screen-reader users had a popup button that never
 * visibly popped. Click now toggles it, Escape closes and returns focus to
 * the trigger, and focus leaving the widget closes it; the CSS hover path
 * stays for mouse users.
 */
export function MediaMenu({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={wrapper}
      className="group relative hidden lg:block"
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
        className="rounded px-3 py-2 hover:bg-chrome-hover"
      >
        Media <span aria-hidden="true">▾</span>
      </button>
      <div
        className={`absolute left-0 z-20 w-44 rounded-b bg-chrome py-1 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="block px-4 py-2 hover:bg-chrome-hover" onClick={() => setOpen(false)}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
