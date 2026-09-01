"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Empties the advert inventory for this browser only, so every slot on the
 * public site falls back to its dashed placeholder. Lets you check slot
 * footprints and spacing without wiping the seeded adverts and re-seeding.
 *
 * Cookie-based on purpose: it is per-browser, so it can never affect a reader,
 * and it survives navigation across the whole public site rather than needing a
 * query string on every URL. Read server-side by adPreview() in lib/adverts.ts.
 * Same pattern as ThemeSwitcher — set the cookie, then refresh so the
 * server components re-render with it.
 */
export function AdPreviewToggle({ initialOn }: { initialOn: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initialOn);

  function toggle() {
    const next = !on;
    // max-age 0 expires it rather than leaving a stale "off" cookie around
    document.cookie = next ? "smi-ads=empty; path=/; max-age=86400" : "smi-ads=; path=/; max-age=0";
    setOn(next);
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-gray-500">Preview unsold state</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {on
              ? "On — the public site shows empty slot placeholders to you only. Adverts are untouched."
              : "Off — the public site shows the real booked adverts."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={on}
          className={`shrink-0 rounded px-3 py-1.5 text-sm font-semibold ${
            on ? "bg-brand text-ink" : "border bg-white text-ink hover:border-ink"
          }`}
        >
          {on ? "Turn off" : "Turn on"}
        </button>
      </div>
    </div>
  );
}
