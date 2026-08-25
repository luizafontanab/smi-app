"use client";
import Image from "next/image";
import { useState } from "react";

/** Crop focus control: click sets the focal point, slider zooms. Values stored in cover_focus. */
export function FocusPicker({ src, initial }: { src: string; initial: { x: number; y: number; scale: number } }) {
  const [focus, setFocus] = useState(initial);
  return (
    <div className="mt-1" role="group" aria-labelledby="focus-picker-label">
      <div
        className="relative h-48 w-80 cursor-crosshair overflow-hidden rounded border"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFocus((f) => ({ ...f, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
        }}
      >
        <Image
          src={src}
          alt=""
          fill
          sizes="320px"
          unoptimized
          className="object-cover"
          style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%`, transform: `scale(${focus.scale})` }}
        />
        <span
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white/60"
          style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        Zoom
        <input
          type="range" min="1" max="2" step="0.05" value={focus.scale}
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
