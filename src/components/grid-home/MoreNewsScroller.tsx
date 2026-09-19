"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The More News carousel's scroll container, with edge-hover auto-scroll: rest
 * the pointer near either end and the row glides that way until you move off
 * or it runs out of cards.
 *
 * A client island rather than part of cards.tsx, which is a server module — the
 * tiles themselves are still rendered on the server and passed in as children,
 * so this ships the scroll behaviour and nothing else.
 *
 * Four things this deliberately does NOT do:
 *   · No overlay hot-zones. The pointer's position is measured against the
 *     scroller's own box on pointermove, so there is no absolutely-positioned
 *     div sitting over the first and last tiles swallowing their clicks.
 *   · No touch. pointerType is checked, because on a phone every swipe is a
 *     pointermove that starts at the edge — it would fight the finger.
 *   · No motion for anyone who asked for none. prefers-reduced-motion turns
 *     the whole thing off; the row is still a normal scroller, and the tiles'
 *     own hover reveal is unaffected.
 *   · No keyboard equivalent, because it needs none: tabbing through the tiles
 *     already scrolls them into view, which is the accessible path to the same
 *     place. This is a mouse convenience on top of a scroller that works
 *     without it, never the only way to reach a card.
 */

/** Pixels per second at the very edge, easing to nothing at EDGE_PX inward. */
const MAX_SPEED = 160;
/** How deep the sensitive strip at each end is. */
const EDGE_PX = 80;

/** Everything the frame loop needs, in one mutable box. */
type Glide = {
  el: HTMLUListElement | null;
  /** Signed px/sec; 0 parks the loop. */
  speed: number;
  frame: number | null;
  last: number;
};

/**
 * The animation frame. A module-level function taking its state as an argument
 * rather than a callback closing over refs: it has to call itself, and a hook
 * that references its own binding is both a lint error and a real reactivity
 * trap waiting to happen.
 */
function tick(g: Glide, now: number): void {
  if (!g.el || g.speed === 0) {
    g.frame = null;
    return;
  }
  // Time-based, not per-frame: a 120Hz display should not scroll twice as fast
  // as a 60Hz one. Clamped so a backgrounded tab returning doesn't apply one
  // enormous delta.
  const dt = Math.min((now - g.last) / 1000, 0.05);
  g.last = now;
  g.el.scrollLeft += g.speed * dt;
  g.frame = requestAnimationFrame((t) => tick(g, t));
}

export function MoreNewsScroller({ className, children }: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const glide = useRef<Glide>({ el: null, speed: 0, frame: null, last: 0 });

  const stop = useCallback(() => {
    const g = glide.current;
    g.speed = 0;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    // Hand snapping back to CSS so the row settles onto a tile edge.
    if (g.el) g.el.style.scrollSnapType = "";
  }, []);

  // Stop on unmount, or the loop outlives the element it is scrolling.
  useEffect(() => stop, [stop]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLUListElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Nothing to scroll: leave snapping alone and park the loop.
    if (el.scrollWidth <= el.clientWidth + 1) return stop();

    const { left, width } = el.getBoundingClientRect();
    const x = e.clientX - left;
    // Ramp with depth into the strip, so the row creeps at the inner boundary
    // and only reaches MAX_SPEED at the very edge — "slowly", with a way to
    // ask for more without a control to click.
    const next =
      x < EDGE_PX ? -MAX_SPEED * ((EDGE_PX - x) / EDGE_PX)
      : x > width - EDGE_PX ? MAX_SPEED * ((x - (width - EDGE_PX)) / EDGE_PX)
      : 0;

    if (next === 0) return stop();
    const g = glide.current;
    g.el = el;
    g.speed = next;
    if (g.frame === null) {
      // Mandatory snapping fights a per-frame scrollLeft — the row rubber-bands
      // back to the nearest tile every time it is nudged. Suspended while the
      // glide runs and restored by stop(), which is what makes it settle.
      el.style.scrollSnapType = "none";
      g.last = performance.now();
      g.frame = requestAnimationFrame((t) => tick(g, t));
    }
  }, [stop]);

  return (
    <ul ref={ref} className={className} onPointerMove={onPointerMove} onPointerLeave={stop} onPointerDown={stop}>
      {children}
    </ul>
  );
}
