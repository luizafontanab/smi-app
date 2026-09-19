"use client";

import { useEffect } from "react";
import { buildCloud, CARD_H, type Bucket, type CloudItem } from "@/lib/cloud-layout";

/**
 * The member cloud's only client code. It renders nothing and receives no
 * member data — it reads what it needs back off the DOM the server already
 * wrote, which keeps the client payload flat regardless of directory size.
 *
 * Two jobs:
 *
 * 1. **Settle.** The server packs against an estimate of each name's width,
 *    because font metrics don't exist there. Once the real face has loaded,
 *    this measures every name and repacks with the true widths. The correction
 *    eases into place — that is the settle, and it is also what guarantees no
 *    two names overlap rather than merely probably not.
 *
 * 2. **Two-tap.** A touch device has no hover, so the first tap reveals a
 *    member's logo and the second follows the link. One delegated listener,
 *    not one per name. The link is never rewritten, so with JS off — or before
 *    this mounts — a tap simply navigates, which is the right degradation:
 *    the logo peek is the enhancement, the link is the content.
 */

const SHEET_ID = "member-cloud-refined";
/**
 * See the measurement in refine(). Covers the gap between what a name measures
 * and what it finally paints: a late font swap, and the sub-pixel rounding of a
 * fractional cqw position against a fractional text width. Measured empirically
 * — 1.02 still left a ~2px sliver on a 390px viewport.
 */
const MEASURE_MARGIN = 1.04;
const BUCKET_QUERY = "(max-width: 639px)";
const COARSE_QUERY = "(hover: none), (pointer: coarse)";

const VARS = {
  wide: { x: "--x", y: "--y", s: "--s", cx: "--cx", cy: "--cy", h: "--cloud-h" },
  narrow: { x: "--xn", y: "--yn", s: "--sn", cx: "--cxn", cy: "--cyn", h: "--cloud-hn" },
} as const;

export function CloudRefine({ containerId, seed }: { containerId: string; seed: string }) {
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Everything here is enhancement over a server layout that is already
    // correct, so a runtime without matchMedia gets the cloud as rendered
    // rather than a thrown effect.
    if (typeof window.matchMedia !== "function") return;

    let cancelled = false;

    const refine = (bucket: Bucket) => {
      const nodes = [...container.querySelectorAll<HTMLLIElement>("li.cloud-item")];
      const width = container.clientWidth;
      if (nodes.length === 0 || width === 0) return;

      // Rebuild the packer's input in its original (seeded) order — the DOM is
      // in alphabetical order for the tab sequence, so data-i carries the link
      // back. All reads happen here, before any write, so the browser lays out
      // once instead of once per name.
      const items: CloudItem[] = [];
      const widths: number[] = [];
      for (const li of nodes) {
        const i = Number(li.dataset.i);
        const name = li.querySelector<HTMLElement>(".cloud-name");
        if (!name || !Number.isFinite(i)) return;
        items[i] = { slug: "", name: name.textContent ?? "", featured: li.dataset.featured === "true" };
        // px -> cqw, the unit the whole layout is expressed in, plus a small
        // margin. A measurement can still be taken a hair before the final face
        // is in place, and a width that is under the truth is the one failure
        // that shows: the packer then allows an x the glyphs overrun.
        widths[i] = (name.getBoundingClientRect().width / width) * 100 * MEASURE_MARGIN;
      }
      // A zero-width measurement means the cloud is display:none or the fonts
      // never resolved. The server layout is already correct; leave it alone.
      if (widths.some((w) => !w)) return;
      if (cancelled) return;

      const { placements, height } = buildCloud(items, { seed, bucket, widths });
      const v = VARS[bucket];

      // Publish the correction as a stylesheet rather than by writing inline
      // styles. The server already rendered its own values inline, and React
      // owns that attribute — it rewrites `style` wholesale on any re-render,
      // which silently reverted the correction and put names back outside the
      // container. A stylesheet is not React's to touch; `!important` is what
      // lets it outrank the inline values it is correcting.
      const rules = [`#${containerId}{${v.h}:${height} !important}`];
      for (const li of nodes) {
        const i = Number(li.dataset.i);
        const p = placements[i];
        const cy = p.cardBelow ? p.s * 1.2 + 0.8 : -(CARD_H + 0.8);
        rules.push(
          `#${containerId} li[data-i="${i}"]{${v.x}:${p.x} !important;${v.y}:${p.y} !important;` +
            `${v.cx}:${p.cardDx} !important;${v.cy}:${cy} !important}`,
        );
      }

      let sheet = document.getElementById(SHEET_ID) as HTMLStyleElement | null;
      if (!sheet) {
        sheet = document.createElement("style");
        sheet.id = SHEET_ID;
        document.head.appendChild(sheet);
      }
      // Enable the easing and force a style flush first, so the browser has a
      // "before" state that already carries the transition and the correction
      // eases in rather than jumping.
      container.dataset.settled = "true";
      void container.offsetWidth;
      sheet.textContent = rules.join("");
    };

    const bucketOf = (): Bucket => (window.matchMedia(BUCKET_QUERY).matches ? "narrow" : "wide");
    const run = () => {
      if (!cancelled) refine(bucketOf());
    };

    // Measure against the real face, not the metric-compatible fallback —
    // and only once. `fonts.ready` alone can resolve before a face that had
    // not begun loading is applied, leaving names measured a few percent
    // narrow; `load` alone is later than it needs to be. Waiting for both and
    // packing once avoids the visible double re-shuffle that running on each
    // signal produced.
    const settled = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true })),
    ]);
    void settled.then(run);

    const bucketMq = window.matchMedia(BUCKET_QUERY);
    bucketMq.addEventListener("change", run);

    /* ── two-tap ── */
    const clear = () => {
      container.querySelectorAll<HTMLElement>("li[data-revealed]").forEach((li) => delete li.dataset.revealed);
    };

    const onClick = (e: MouseEvent) => {
      if (!window.matchMedia(COARSE_QUERY).matches) return; // desktop is pure hover
      const li = (e.target as Element | null)?.closest?.("li.cloud-item") as HTMLElement | null;
      if (!li) return;
      if (li.dataset.revealed === "true") return; // second tap — let the link run
      // preventDefault on click, not pointerdown, so scrolling and long-press
      // are untouched.
      e.preventDefault();
      clear();
      li.dataset.revealed = "true";
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.("li.cloud-item")) clear();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };

    container.addEventListener("click", onClick);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      // Rules are keyed by the packer's index, which is only meaningful for the
      // member set that produced them — leaving them behind would misplace a
      // differently-filtered cloud.
      document.getElementById(SHEET_ID)?.remove();
      bucketMq.removeEventListener("change", run);
      container.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [containerId, seed]);

  return null;
}
