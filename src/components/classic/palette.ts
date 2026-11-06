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
  // #71 header: the grey top bar, and the flat menu's resting link colour.
  "--classic-topbar": "#555555",
  "--classic-nav-link": "#b4b4b4",
  // #78 join page. The banner's PLACEHOLDER backdrop (no photo yet,
  // docs/HUMAN-TODO.md 7.5): the lightest stop of its gradient, under white text.
  "--classic-join-banner": "#2b3440",
  // The live site's red icon disc (decorative: it holds an emoji, no text).
  "--classic-red": "#e3141e",
  // #80 forms: the error red (Current's --smi-danger) and a field's border,
  // which has to reach 3:1 on white to show where the field is (WCAG 1.4.11).
  "--classic-danger": "#b91c1c",
  "--classic-field-edge": "#8c8c8c",
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
  { label: "card title on a card", fg: c["--smi-ink"], bg: c["--classic-panel"], min: TEXT },
  { label: "card arrow chip: white on blue", fg: c["--classic-button-text"], bg: c["--classic-blue"], min: TEXT },
  { label: "card arrow chip hover: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "video play glyph: ink on the white disc", fg: c["--smi-ink"], bg: c["--classic-panel"], min: TEXT },
  { label: "featured member tab: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "focus ring on a panel", fg: c["--classic-blue"], bg: c["--classic-panel"], min: NON_TEXT },
  { label: "focus ring on the canvas", fg: c["--classic-blue"], bg: c["--classic-canvas"], min: NON_TEXT },
  { label: "focus ring on a stripe", fg: c["--classic-blue"], bg: c["--classic-stripe"], min: NON_TEXT },
  { label: "focus ring on the black chrome", fg: c["--smi-brand"], bg: c["--classic-chrome"], min: NON_TEXT },
  // #72 footer. Back to Top strip: ink on white, hovering blue, blue ring.
  { label: "footer Back to Top: ink on white", fg: c["--smi-ink"], bg: c["--classic-panel"], min: TEXT },
  { label: "footer Back to Top hover: blue on white", fg: c["--classic-blue"], bg: c["--classic-panel"], min: TEXT },
  // The orange band: ink text; a blue button that hovers to ink, never to
  // orange on orange (decisions 6 Nov, 6); an ink focus ring, since the
  // chrome's orange ring would vanish on the band (decisions 6 Nov, 11).
  { label: "footer band text: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "footer band button: white on blue", fg: c["--classic-button-text"], bg: c["--classic-blue"], min: TEXT },
  { label: "footer band button hover: white on ink", fg: c["--classic-button-text"], bg: c["--smi-ink"], min: TEXT },
  { label: "footer band button edge: blue on orange", fg: c["--classic-blue"], bg: c["--smi-brand"], min: NON_TEXT },
  { label: "footer band button hover edge: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: NON_TEXT },
  { label: "footer band focus ring: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: NON_TEXT },
  // The black stack: white text, links hovering orange.
  { label: "footer text: white on black", fg: c["--classic-panel"], bg: c["--classic-chrome"], min: TEXT },
  { label: "footer link hover: orange on black", fg: c["--smi-brand"], bg: c["--classic-chrome"], min: TEXT },
  // #71 header. White is written as the panel colour (#fff).
  { label: "top bar text", fg: c["--classic-panel"], bg: c["--classic-topbar"], min: TEXT },
  { label: "focus ring on the top bar", fg: c["--classic-panel"], bg: c["--classic-topbar"], min: NON_TEXT },
  { label: "menu link on the black chrome", fg: c["--classic-nav-link"], bg: c["--classic-chrome"], min: TEXT },
  { label: "current menu link on the black chrome", fg: c["--classic-panel"], bg: c["--classic-chrome"], min: TEXT },
  { label: "current-section underline on the black chrome", fg: c["--smi-brand"], bg: c["--classic-chrome"], min: NON_TEXT },
  // #77 newsletter issue: the #n badge, and the sponsored story on the canvas grey.
  { label: "newsletter item number: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "newsletter sponsored story title: ink on the canvas", fg: c["--smi-ink"], bg: c["--classic-canvas"], min: TEXT },
  { label: "newsletter sponsored story label and copy: meta on the canvas", fg: c["--classic-meta"], bg: c["--classic-canvas"], min: TEXT },
  { label: "newsletter sponsored story link: blue on the canvas", fg: c["--classic-blue"], bg: c["--classic-canvas"], min: TEXT },
  { label: "newsletter sponsored story link hover: blue on the canvas", fg: c["--classic-blue-hover"], bg: c["--classic-canvas"], min: TEXT },
  // #78 join page. The banner title is white over the placeholder gradient,
  // whose stops only get darker than this one. A real photo must keep an
  // overlay at least this dark behind the title.
  { label: "join banner title: white on the banner", fg: c["--classic-panel"], bg: c["--classic-join-banner"], min: TEXT },
  { label: "join step numbers: ink on orange", fg: c["--smi-ink"], bg: c["--smi-brand"], min: TEXT },
  { label: "join step detail: meta on a panel", fg: c["--classic-meta"], bg: c["--classic-panel"], min: TEXT },
  // #80 forms on the contact, advertising and join-account panels: the error
  // message and its edge, an invalid field's border, and a field's own border.
  { label: "form error text: red on a panel", fg: c["--classic-danger"], bg: c["--classic-panel"], min: TEXT },
  { label: "form error edge and invalid field border: red on a panel", fg: c["--classic-danger"], bg: c["--classic-panel"], min: NON_TEXT },
  { label: "form field border on a panel", fg: c["--classic-field-edge"], bg: c["--classic-panel"], min: NON_TEXT },
];
