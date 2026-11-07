import { describe, expect, it } from "vitest";
import { classicCss, partsTargeted, rulesOf, sectionOf, selectorsOf } from "./classic-css-selectors";
import { CLASSIC_COLOURS, CLASSIC_CONTRAST_PAIRS } from "@/components/classic/palette";

/**
 * Classic detail and plain pages (#80): /event/[slug], /video/[slug],
 * /member/[slug], the CMS pages, /featured-machine, /advertising, /contact,
 * /newsletters and /join/account are restyled through classic.css alone.
 * Seam 3's selector test already proves every part named here exists in src;
 * this pins what the #80 section reaches (the disc-and-title head, the white
 * panels, the form fields and their error state) and what it must leave alone
 * (the member page's background, utilities that show and hide things).
 */

const css = classicCss;

/** Innermost `selector { declarations }` pairs, comments stripped. Rules inside @media come out too. */
const pageCss = sectionOf(css, "#80");
const selectors = selectorsOf(pageCss);
const rules = rulesOf(pageCss);
/** Rules whose selector list includes a selector naming `part`. */
const rulesFor = (part: string) => rules.filter((r) => partsTargeted(r.selector).includes(part));
/** Rules that style the element `part` itself: some selector in the list ends at it. */
const rulesOn = (part: string) => rules.filter((r) => r.selector.split(",").some((s) => s.trim().endsWith(`[data-part="${part}"]`)));

/** Plain pages: the title sits on the canvas and gets the list pages' disc. */
const PLAIN_ROOTS = ["cms-page", "featured-machine-page", "advertising-page", "contact-page", "newsletter-list-page"];
/** Detail pages drawn on one white panel. The member page keeps its own cards. */
const PANEL_ROOTS = ["event-page", "video-page"];
/** Pages carrying a form: contact, the advertising enquiry, join step 1. */
const FORM_ROOTS = ["contact-page", "advertising-page", "join-account-page"];
const ROOTS = [...PLAIN_ROOTS, ...PANEL_ROOTS, "member-page", "join-account-page"];

describe("Classic detail and plain pages (#80)", () => {
  it.each(PLAIN_ROOTS)("give %s the disc-and-title head", (root) => {
    expect(selectors.some((s) => partsTargeted(s).includes(root) && partsTargeted(s).includes("page-title") && s.endsWith("::before"))).toBe(true);
  });

  it.each(PANEL_ROOTS)("draw %s on one white panel", (root) => {
    const panel = rulesOn(root).filter((r) => /background-color:\s*var\(--classic-panel\)/.test(r.body));
    expect(panel.length).toBeGreaterThan(0);
  });

  it.each(PANEL_ROOTS)("make the share buttons on %s Classic's blue buttons", (root) => {
    const share = rulesFor("share-button").filter((r) => partsTargeted(r.selector).includes(root));
    expect(share.some((r) => /background-color:\s*var\(--classic-blue\)/.test(r.body))).toBe(true);
  });

  it("give the member page no background of its own (no member-colour page, #80)", () => {
    const own = rulesOn("member-page").filter((r) => /background/.test(r.body));
    expect(own).toEqual([]);
  });

  it.each(FORM_ROOTS)("give the fields on %s Classic's 5px corners and a 52px height", (root) => {
    const fields = rulesFor("form-input").filter((r) => partsTargeted(r.selector).includes(root));
    expect(fields.some((r) => /border-radius:\s*var\(--classic-radius\)/.test(r.body))).toBe(true);
    expect(fields.some((r) => /min-height:\s*3\.25rem/.test(r.body))).toBe(true);
  });

  it.each(FORM_ROOTS)("mark an invalid field on %s with the error colour", (root) => {
    const invalid = rulesFor("form-input").filter((r) => partsTargeted(r.selector).includes(root) && r.selector.includes('[aria-invalid="true"]'));
    expect(invalid.some((r) => /var\(--classic-danger\)/.test(r.body))).toBe(true);
  });

  it("style the form error only once it holds a message (empty, it is an sr-only live region)", () => {
    const errors = rulesFor("form-error");
    expect(errors.length).toBeGreaterThan(0);
    for (const r of errors) {
      for (const s of r.selector.split(/,(?![^(]*\))/)) if (partsTargeted(s).includes("form-error")) expect(s).toContain(":not(:empty)");
      // Never fight sr-only's own box: it hides the region by size, position and clipping.
      expect(r.body).not.toMatch(/(^|[;\s])(position|width|height|clip|clip-path|overflow|margin|display)\s*:/);
    }
    expect(errors.some((r) => /color:\s*var\(--classic-danger\)/.test(r.body))).toBe(true);
  });

  it("add the form colours to the contrast pairs", () => {
    const c = CLASSIC_COLOURS as Record<string, string>;
    const pairs = CLASSIC_CONTRAST_PAIRS.map((p) => `${p.fg} on ${p.bg} @${p.min}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        `${c["--classic-danger"]} on ${c["--classic-panel"]} @4.5`, // the error text
        `${c["--classic-danger"]} on ${c["--classic-panel"]} @3`, // the error edge and an invalid field's border
        `${c["--classic-field-edge"]} on ${c["--classic-panel"]} @3`, // a field's border
      ]),
    );
  });

  it("set display only on the plain pages' titles and their disc, never on a part a utility shows and hides", () => {
    const withDisplay = rules.filter((r) => /(^|[;\s])display\s*:/.test(r.body));
    expect(withDisplay.length).toBeGreaterThan(0);
    for (const r of withDisplay) {
      for (const s of r.selector.split(/,(?![^(]*\))/)) expect(s.trim()).toMatch(/\[data-part="page-title"\](::before)?$/);
    }
  });

  it("reach shared parts (page-title, form-input, share-button…) only from inside one of these pages", () => {
    const loose = selectors.filter((s) => !partsTargeted(s).some((p) => ROOTS.includes(p)));
    expect(loose).toEqual([]);
  });
});

