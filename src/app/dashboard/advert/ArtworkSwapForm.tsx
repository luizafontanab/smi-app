"use client";

import { useState } from "react";
import { proposeOwnArtworkSwap } from "../actions";
import { RequiredMark } from "@/components/RequiredMark";

/**
 * Swap-only — no name, format, link or dates. Those are fixed once a run is
 * scheduled; only the images can change, and only through review.
 */
export function ArtworkSwapForm({ advertId, bookingId }: { advertId: string; bookingId: string }) {
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);

  const preview = (file: File | undefined, set: (url: string | null) => void) => {
    if (!file) return;
    set(URL.createObjectURL(file));
  };

  return (
    <form action={proposeOwnArtworkSwap} className="mt-3 space-y-3 text-sm">
      <input type="hidden" name="advert_id" value={advertId} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="swap-desktop" className="text-sm font-medium">New desktop artwork<RequiredMark /></label>
          <input id="swap-desktop" name="desktop" type="file" accept="image/jpeg,image/png,image/webp" required
            onChange={(e) => preview(e.target.files?.[0], setDesktopUrl)} className="mt-1 w-full text-sm" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {desktopUrl && <img src={desktopUrl} alt="" className="mt-2 w-full rounded border" />}
        </div>
        <div>
          <label htmlFor="swap-mobile" className="text-sm font-medium">New mobile artwork<RequiredMark /></label>
          <input id="swap-mobile" name="mobile" type="file" accept="image/jpeg,image/png,image/webp" required
            onChange={(e) => preview(e.target.files?.[0], setMobileUrl)} className="mt-1 w-full text-sm" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {mobileUrl && <img src={mobileUrl} alt="" className="mt-2 w-full max-w-[370px] rounded border" />}
        </div>
      </div>
      <button className="rounded bg-ink px-4 py-2 text-white">Send for approval</button>
      <p className="text-xs text-graphite">The current artwork keeps running until this is approved — the dates don&apos;t change either way.</p>
    </form>
  );
}
