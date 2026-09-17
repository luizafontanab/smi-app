/**
 * WCAG 2.1 contrast (the real §1.4.3 "AA" criterion — there is no contrast
 * rule at Level A, so a homepage takeover's hex checks against the numbers
 * the spec almost certainly meant: 4.5:1 for normal text, 3:1 for large text
 * or non-text UI). Pure and side-effect free so it unit-tests without a DOM.
 */

const HEX_RE = /^#?([0-9a-f]{6})$/i;

function hexToRgb(hex: string): [number, number, number] {
  const match = HEX_RE.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB → relative luminance, per the WCAG formula (linearise, then weight by eye sensitivity). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** (L1 + 0.05) / (L2 + 0.05), lighter over darker — symmetric in the two colours. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 4.5:1 normal text, 3:1 large text (≥18pt, or ≥14pt bold) or non-text UI. */
export function meetsWcagAA(hex: string, background: string, opts: { largeText?: boolean } = {}): boolean {
  return contrastRatio(hex, background) >= (opts.largeText ? 3 : 4.5);
}
