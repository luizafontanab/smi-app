/**
 * Classic's colours and the pairs that have to pass WCAG AA (spec #68, #70).
 *
 * classic.css declares each of these custom properties with the same value
 * inside [data-site="public"], and tests/unit/classic/contrast.test.ts checks
 * both: every pair below against src/lib/contrast.ts, and every value below
 * against its declaration in the sheet. Change a colour here and in the sheet
 * together, or the test fails.
 *
 * Orange stays `--smi-brand`: rules read it through var(), so a sponsor
 * takeover's inline value still wins (decisions 6 Nov, 2).
 */
export const CLASSIC_COLOURS = {
  "--smi-brand": "#ff8200",
  "--smi-ink": "#111418",
  "--classic-canvas": "#e2e2e2",
  "--classic-stripe": "#dbdbdb",
  "--classic-panel": "#ffffff",
  "--classic-chrome": "#000000",
  "--classic-blue": "#3100ff",
  "--classic-blue-hover": "#1d0099",
  "--classic-button-text": "#ffffff",
  // #606060, not the spec's #666: #666 on the canvas is 4.43:1 (decisions 6 Nov, 1).
  "--classic-meta": "#606060",
} as const;

const c = CLASSIC_COLOURS;
/** AA for normal text; 3:1 for non-text UI such as the focus ring. */
const TEXT = 4.5;
const NON_TEXT = 3;

export type ContrastPair = { label: string; fg: string; bg: string; min: number };

export const CLASSIC_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { label: "ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "button hover: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "meta on a panel", fg: c["--classic-meta"], bg: c["--classic-panel"], min: TEXT },
  { label: "meta on the canvas", fg: c["--classic-meta"], bg: c["--classic-canvas"], min: TEXT },
  { label: "meta on a stripe", fg: c["--classic-meta"], bg: c["--classic-stripe"], min: TEXT },
  { label: "primary button text", fg: c["--classic-button-text"], bg: c["--classic-blue"], min: TEXT },
  { label: "link on a panel", fg: c["--classic-blue"], bg: c["--classic-panel"], min: TEXT },
  { label: "link on the canvas", fg: c["--classic-blue"], bg: c["--classic-canvas"], min: TEXT },
  { label: "link hover on a panel", fg: c["--classic-blue-hover"], bg: c["--classic-panel"], min: TEXT },
  { label: "link hover on the canvas", fg: c["--classic-blue-hover"], bg: c["--classic-canvas"], min: TEXT },
  { label: "focus ring on a panel", fg: c["--classic-blue"], bg: c["--classic-panel"], min: NON_TEXT },
  { label: "focus ring on the canvas", fg: c["--classic-blue"], bg: c["--classic-canvas"], min: NON_TEXT },
  { label: "focus ring on a stripe", fg: c["--classic-blue"], bg: c["--classic-stripe"], min: NON_TEXT },
  { label: "focus ring on the black chrome", fg: c["--smi-brand"], bg: c["--classic-chrome"], min: NON_TEXT },
];
