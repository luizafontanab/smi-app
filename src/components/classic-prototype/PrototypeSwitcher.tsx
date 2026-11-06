"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/* PROTOTYPE switcher (issue #59). Not part of the design being judged. */
export function PrototypeSwitcher({ variants, names, current }: {
  variants: readonly string[];
  names: Record<string, string>;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const i = Math.max(0, variants.indexOf(current));
  const go = (d: number) => {
    const next = variants[(i + d + variants.length) % variants.length];
    router.replace(`${pathname}?variant=${next}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]"))) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;
  const btn = "grid h-9 w-9 place-items-center rounded-full hover:bg-white/15";
  return (
    <div
      style={{ fontFamily: "ui-monospace, monospace" }}
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-700 px-2 py-1 text-sm text-white shadow-2xl ring-2 ring-white"
    >
      <button type="button" className={btn} onClick={() => go(-1)} aria-label="Previous variant">←</button>
      <span className="min-w-56 text-center">PROTOTYPE · {current === "current" ? "Current" : current} ({names[current]})</span>
      <button type="button" className={btn} onClick={() => go(1)} aria-label="Next variant">→</button>
    </div>
  );
}
