"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdCreative, type AdShape } from "@/components/AdCreative";

/**
 * One banner position: cycles through the adverts dealt to it for this page
 * load (lib/adverts.ts dealSlots, BANNERS_PER_POSITION). Decided 4 Oct — the
 * in-page carousel docs/HUMAN-TODO.md §5.4 left open. Order is the caller's,
 * used as given: nothing here picks, reorders or filters by advertiser.
 *
 * Every carousel on the page advances off ONE shared ticker, so positions turn
 * over together. That is what keeps the banners on screen at any one moment
 * different from each other — dealSlots' round-robin guarantees it for frames
 * shown in lockstep, and only for those.
 *
 * Frames are stacked in a single grid cell, so the footprint is one banner's
 * and nothing below shifts as it cycles. Inactive frames are inert and hidden
 * from assistive tech — one advert is on screen, one is announced and
 * focusable. Each frame counts its own impression, only while it is the active
 * one (AdCreative `active`).
 *
 * Accessibility, as FeaturedMembersCarousel:
 *   · WCAG 2.2.2 — pauses on hover and on keyboard focus anywhere inside.
 *   · prefers-reduced-motion turns the advance (and the fade) off; the dots
 *     still work, so every advert stays reachable.
 *   · Dots are real buttons at a 24px tap target (WCAG 2.5.8), and only exist
 *     when there is more than one advert to show.
 *   · On touch, a horizontal swipe steps through the adverts too (WCAG 2.5.1:
 *     the dots remain the single-pointer alternative to the gesture).
 */

export type CarouselAdvert = { advertId: string; name: string; href: string; desktop: string; mobile: string };

/** Dwell per advert. Longer than Featured Members' 4.5s — banners are peripheral to the page. */
export const AD_CAROUSEL_INTERVAL_MS = 6000;

/** Horizontal travel that counts as a swipe rather than a wobbly tap. */
const SWIPE_MIN_PX = 40;

const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

/** Subscribe to the page-wide tick. The interval only runs while someone listens. */
function onTick(listener: () => void): () => void {
  listeners.add(listener);
  ticker ??= setInterval(() => listeners.forEach((l) => l()), AD_CAROUSEL_INTERVAL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

export function AdCarousel({ adverts, shape, path }: { adverts: CarouselAdvert[]; shape: AdShape; path: string }) {
  const count = adverts.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return onTick(() => setActive((i) => (i + 1) % count));
  }, [count, paused]);

  const hold = useCallback(() => setPaused(true), []);
  const release = useCallback(() => setPaused(false), []);

  // Swipe (Jas 13/10 item 6). A horizontal flick steps one advert either way;
  // a mostly-vertical drag is left alone so the page still scrolls (touch-pan-y
  // keeps vertical panning native and hands horizontal moves to us). The tick
  // is held for the length of the touch so a frame can't change mid-gesture.
  // Like a dot click, a swipe moves only this carousel's phase — impressions
  // are unaffected: the frame that is `active` is still the only one counting.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swiped.current = false;
    hold();
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    release();
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped.current = true;
    setActive((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
  };
  // A swipe that ends over the advert's link must not also follow it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swiped.current) return;
    swiped.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  if (count === 0) return null;
  if (count === 1) {
    const ad = adverts[0];
    return <AdCreative {...ad} shape={shape} path={path} />;
  }

  return (
    <div onMouseEnter={hold} onMouseLeave={release} onFocusCapture={hold} onBlurCapture={release}>
      <div
        className="grid touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { touchStart.current = null; release(); }}
        onClickCapture={onClickCapture}
      >
        {adverts.map((ad, i) => {
          const on = i === active;
          return (
            <div
              key={`${ad.advertId}-${i}`}
              className={`col-start-1 row-start-1 transition-[opacity,visibility] duration-500 motion-reduce:transition-none ${on ? "visible opacity-100" : "invisible opacity-0"}`}
              aria-hidden={on ? undefined : true}
              inert={!on}
            >
              <AdCreative {...ad} shape={shape} path={path} active={on} />
            </div>
          );
        })}
      </div>
      {/* Not a tablist: these switch one advert for another, they label no panels. */}
      <div className="flex justify-center pt-1">
        {adverts.map((ad, i) => (
          <button
            key={`${ad.advertId}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Show advert ${i + 1} of ${count}`}
            aria-current={i === active || undefined}
            className="flex h-6 w-5 items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={`block h-1.5 w-1.5 rounded-full transition-colors ${i === active ? "bg-brand" : "bg-graphite/30"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
