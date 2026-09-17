import type { CSSProperties } from "react";

/**
 * Cover crop focus — the {x, y, scale} box FocusPicker writes into
 * `stories.cover_focus` (jsonb, so every read has to assume garbage).
 *
 * The render model is CSS-only, because next/image runs `unoptimized`
 * everywhere here (no `images` config in next.config.ts): storage bytes reach
 * the browser as uploaded, and there is no resize/crop param to lean on.
 *
 *   pan  → object-position: x% y%   (on an element already using object-cover)
 *   zoom → scale, anchored with transform-origin at the SAME focal point, so
 *          the chosen subject stays put as it grows. Scaling from the element
 *          centre — what the picker used to do — drifts the subject off.
 */
export type Focus = { x: number; y: number; scale: number };

export const DEFAULT_FOCUS: Focus = { x: 0.5, y: 0.5, scale: 1 };

/** Matches FocusPicker's zoom slider. */
const MIN_SCALE = 1;
const MAX_SCALE = 2;

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === "string" ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** jsonb → Focus. Anything malformed degrades to centre / no zoom. */
export function parseFocus(json: unknown): Focus {
  if (!json || typeof json !== "object" || Array.isArray(json)) return DEFAULT_FOCUS;
  const f = json as Record<string, unknown>;
  return {
    x: clamp(f.x, 0, 1, DEFAULT_FOCUS.x),
    y: clamp(f.y, 0, 1, DEFAULT_FOCUS.y),
    scale: clamp(f.scale, MIN_SCALE, MAX_SCALE, DEFAULT_FOCUS.scale),
  };
}

/**
 * Inline style for a cover <Image>. At scale 1 — where every story sits until
 * someone touches the picker — this is object-position alone, so nothing about
 * the existing rendering changes and no transform is introduced that could
 * fight a hover or animation rule.
 */
export function focusStyle(json: unknown): CSSProperties {
  const { x, y, scale } = parseFocus(json);
  const position = `${x * 100}% ${y * 100}%`;
  if (scale === 1) return { objectPosition: position };
  return { objectPosition: position, transform: `scale(${scale})`, transformOrigin: position };
}

/**
 * Same crop, expressed as a custom property, for the two home-hero images whose
 * `transform` is already owned by the ken-burns keyframes and the card hover
 * (an animation outranks an inline style, so `focusStyle` would lose there).
 * The CSS in globals.css multiplies `--focus-scale` into its own transforms.
 */
export function focusVars(json: unknown): CSSProperties {
  const { x, y, scale } = parseFocus(json);
  const position = `${x * 100}% ${y * 100}%`;
  return {
    objectPosition: position,
    ...(scale === 1 ? {} : { transformOrigin: position, "--focus-scale": String(scale) }),
  } as CSSProperties;
}
