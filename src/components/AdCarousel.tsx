"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
 * Accessibility, as FeaturedMembersCarousel, plus:
 *   · WCAG 2.2.2 — a Pause/Play button beside the dots stops the rotation
 *     until the reader starts it again: hover and focus only exist for a mouse
 *     or a keyboard, so touch and screen-reader users had no way to stop it.
 *     The rotation also holds while the pointer is over the advert, while
 *     focus is anywhere inside (bar the toggle itself, or Play would do
 *     nothing until focus left it) and for the length of a touch. Each is its
 *     own flag: with one shared `paused`, leaving with the mouse resumed it
 *     while keyboard focus was still inside, and a blur resumed it under the
 *     pointer.
 *   · prefers-reduced-motion turns the advance (and the fade) off — and with
 *     nothing moving, the Pause button goes too; the dots still work, so every
 *     advert stays reachable.
 *   · Dots are real buttons at a 24px tap target (WCAG 2.5.8), and only exist
 *     when there is more than one advert to show.
 *   · On touch, a horizontal swipe steps through the adverts too (WCAG 2.5.1:
 *     the dots remain the single-pointer alternative to the gesture). The
 *     track allows pinch-zoom as well as vertical panning — touch-pan-y alone
 *     switched pinch-zoom off over every banner (WCAG 1.4.4).
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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Live, so switching the OS setting mid-visit stops (or restarts) the rotation and hides (or shows) its toggle. */
function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

export function AdCarousel({ adverts, shape, path }: { adverts: CarouselAdvert[]; shape: AdShape; path: string }) {
  const count = adverts.length;
  const [active, setActive] = useState(0);
  // Why the rotation is holding — kept apart so one ending can't cancel another.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  /** The reader pressed Pause — holds until they press Play, whatever else happens. */
  const [stopped, setStopped] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const paused = hovered || focused || touching || stopped;
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (count < 2 || paused || reducedMotion) return;
    return onTick(() => setActive((i) => (i + 1) % count));
  }, [count, paused, reducedMotion]);

  /** Focus that holds the rotation: inside the carousel, and not on the Pause/Play toggle. */
  const holdsFocus = (el: EventTarget | null, root: HTMLElement) =>
    el instanceof Node && root.contains(el) && el !== toggleRef.current;

  // Swipe (Jas 13/10 item 6). A horizontal flick steps one advert either way;
  // a mostly-vertical drag is left alone so the page still scrolls (touch-pan-y
  // keeps vertical panning native and hands horizontal moves to us;
  // touch-pinch-zoom keeps the reader's zoom gesture working). The tick
  // is held for the length of the touch so a frame can't change mid-gesture.
  // Like a dot click, a swipe moves only this carousel's phase — impressions
  // are unaffected: the frame that is `active` is still the only one counting.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swiped.current = false;
    setTouching(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    setTouching(false);
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
    <div
      // focus/blur bubble in React (focusin/focusout); relatedTarget says where focus went
      onFocus={(e) => setFocused(holdsFocus(e.target, e.currentTarget))}
      onBlur={(e) => setFocused(holdsFocus(e.relatedTarget, e.currentTarget))}
    >
      <div
        className="grid touch-pan-y touch-pinch-zoom"
        // hover holds over the advert only — not over the controls, or Play
        // would do nothing while the pointer was still on it
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { touchStart.current = null; setTouching(false); }}
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
      <div className="flex items-center justify-center pt-1">
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
        {!reducedMotion && (
          // Same 24px footprint as the dots, in full graphite (6.3:1 — the
          // 3:1 a control needs, WCAG 1.4.11): quiet, but findable.
          // The label names what pressing it does (APG carousel pattern).
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setStopped((s) => !s)}
            aria-label={stopped ? "Play adverts" : "Pause adverts"}
            className="ml-1 flex h-6 w-6 items-center justify-center text-graphite transition-colors hover:text-ink"
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor">
              {stopped ? <path d="M2 1.2v7.6L8.6 5z" /> : <path d="M2 1h2.2v8H2zM5.8 1H8v8H5.8z" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
