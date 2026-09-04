"use client";
import Image from "next/image";
import { useState } from "react";
import { focusStyle, type Focus } from "@/lib/focus";

/**
 * Crop focus control: click (or arrow keys — 5% steps, 1% with Shift) sets
 * the focal point, slider zooms. Values stored in cover_focus.
 *
 * The preview deliberately uses focusStyle — the same helper the public pages
 * render with — so what an admin sees here is what the site does. (It used to
 * zoom from the element centre, which no public page reproduced.)
 */
export function FocusPicker({ src, initial }: { src: string; initial: Focus }) {
  const [focus, setFocus] = useState(initial);
  const nudge = (dx: number, dy: number, step: number) =>
    setFocus((f) => ({
      ...f,
      x: Math.min(1, Math.max(0, f.x + dx * step)),
      y: Math.min(1, Math.max(0, f.y + dy * step)),
    }));
  return (
    <div className="mt-1" role="group" aria-labelledby="focus-picker-label">
      <div
        role="group"
        tabIndex={0}
        aria-label="Focal point — use arrow keys to adjust"
        className="relative h-48 w-80 cursor-crosshair overflow-hidden rounded border"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFocus((f) => ({ ...f, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
        }}
        onKeyDown={(e) => {
          const dir: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
          };
          const d = dir[e.key];
          if (!d) return;
          e.preventDefault();
          nudge(d[0], d[1], e.shiftKey ? 0.01 : 0.05);
        }}
      >
        <Image
          src={src}
          alt=""
          fill
          sizes="320px"
          unoptimized
          className="object-cover"
          style={focusStyle(focus)}
        />
        <span
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white/60"
          style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-graphite">
        Zoom
        <input
          type="range" min="1" max="2" step="0.05" value={focus.scale} aria-label="Zoom"
          onChange={(e) => setFocus((f) => ({ ...f, scale: Number(e.target.value) }))}
        />
        <span>{focus.scale.toFixed(2)}×</span>
      </div>
      <input type="hidden" name="focus_x" value={focus.x} />
      <input type="hidden" name="focus_y" value={focus.y} />
      <input type="hidden" name="focus_scale" value={focus.scale} />
    </div>
  );
}
