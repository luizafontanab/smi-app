"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Featured members box's scroll viewport: a vertical carousel showing
 * three placements at a time, advancing one at a time and wrapping at the end.
 *
 * Why a carousel at all — this is a CONTRACT, not a flourish. The product is
 * sold as "your logo and profile in the homepage carousel"
 * (src/lib/visibility-products.ts, DEFAULT_AD_FORMATS key B, and the console's
 * own Featured Member page), and it had only ever been a static list.
 * docs/HUMAN-TODO.md §14.6 recorded the gap: the copy changes or the component
 * does. This is the component changing.
 *
 * Dots, not a bare scrollbox. Moving content with no control reads as a bug
 * the first time it moves under someone — the dots say "there are more of
 * these" before it ever animates, and they double as the manual control.
 *
 * Accessibility, none of which is optional for auto-moving content:
 *   · WCAG 2.2.2 — it pauses on hover AND on keyboard focus anywhere inside,
 *     so a reader tabbing through the logos is never scrolled away from.
 *   · prefers-reduced-motion turns the advance off entirely. The viewport is
 *     still a scroller and the dots still work, so nothing is unreachable.
 *   · Dots are real buttons at a 24px tap target (WCAG 2.5.8) with a small
 *     painted dot inside, not 8px targets.
 *   · It never advances when everything already fits, and the dots hide too.
 *   · Order is the caller's, used as given — never re-sorted or weighted, the
 *     same rotation rule the advert slots follow (lib/adverts.ts).
 *
 * Either axis (#33 C12): the caller lays the list out vertically at lg and as
 * a sideways row below it, and this follows whichever the CSS chose — read
 * from the scroller's computed overflow, so the breakpoint lives in one place.
 * It never advances on a device without hover: there is nothing to pause it
 * with, and a row sliding under a thumb mid-swipe is the bug-feeling the dots
 * exist to prevent. Swiping and the dots still move it.
 */

/** True when the CSS has laid the list out as a sideways row (below lg). */
function sideways(el: HTMLElement): boolean {
  return getComputedStyle(el).overflowX !== "hidden";
}

/** Dwell per slide. Long, because this is peripheral to the page's content. */
const INTERVAL_MS = 4500;

export function FeaturedMembersCarousel({ className, count, children }: {
  className?: string;
  /** Slide count, for the dots — children are opaque to this component. */
  count: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);
  // Starts false and is set after layout: on the server, and on the very
  // first client render, there is no box to measure. Rendering the dots
  // optimistically would flash a control that then vanishes.
  const [overflows, setOverflows] = useState(false);

  /** Scroll offset of slide i, in the scroller's own coordinates, on its axis. */
  const offsetOf = (el: HTMLElement, i: number) => {
    const li = el.children[i] as HTMLElement | undefined;
    if (!li) return 0;
    return sideways(el) ? li.offsetLeft - el.offsetLeft : li.offsetTop - el.offsetTop;
  };
  const scrollTo = (el: HTMLElement, offset: number) =>
    el.scrollTo(sideways(el) ? { left: offset, behavior: "smooth" } : { top: offset, behavior: "smooth" });

  const goTo = useCallback((i: number) => {
    const el = ref.current;
    if (!el) return;
    scrollTo(el, offsetOf(el, i));
  }, []);

  const advance = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Within a pixel of the end — scroll offsets are fractional after a smooth
    // scroll, so an exact comparison would miss the wrap.
    const atEnd = sideways(el)
      ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      : el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    scrollTo(el, atEnd ? 0 : offsetOf(el, active + 1));
  }, [active]);

  // Which slide is showing, read back from the scroll position rather than
  // tracked separately — that way a wheel or a drag moves the dots too.
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const at = sideways(el) ? el.scrollLeft : el.scrollTop;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const d = Math.abs(offsetOf(el, i) - at);
      if (d < bestDistance) [bestDistance, best] = [d, i];
    }
    setActive(best);
  }, []);

  // Re-measured on resize: the panel's height comes from the grid row beside
  // it, so three-of-eight at desktop can be all-of-three on a narrow screen —
  // and crossing lg flips the axis.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setOverflows(sideways(el) ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  useEffect(() => {
    if (paused || !overflows) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    const id = setInterval(advance, INTERVAL_MS);
    return () => clearInterval(id);
  }, [advance, paused, overflows]);

  const hold = useCallback(() => setPaused(true), []);
  const release = useCallback(() => setPaused(false), []);

  return (
    <>
      <ul
        ref={ref}
        className={className}
        onScroll={onScroll}
        onMouseEnter={hold}
        onMouseLeave={release}
        onFocusCapture={hold}
        onBlurCapture={release}
      >
        {children}
      </ul>
      {overflows && (
        // Not a tablist: these scroll one list, they don't swap panels. A row
        // of buttons is what it is, and the label carries the position.
        <div className="flex shrink-0 justify-center pt-2" onMouseEnter={hold} onMouseLeave={release}>
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show featured member ${i + 1} of ${count}`}
              aria-current={i === active || undefined}
              // 44px tall on touch, where the dots are the only control besides a swipe
              className="flex h-6 w-5 items-center justify-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-8"
            >
              <span
                aria-hidden="true"
                className={`block h-1.5 w-1.5 rounded-full transition-colors ${i === active ? "bg-brand" : "bg-graphite/30"}`}
              />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
