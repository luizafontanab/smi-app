import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { CLASSIC_COLOURS, CLASSIC_CONTRAST_PAIRS } from "@/components/classic/palette";
import { classicCss, rulesOf, selectorsOf } from "./css-selectors";

/**
 * A sponsor takeover recolours --smi-brand to the sponsor's hex, and the
 * public wrapper carries data-takeover while it does (#68 review, decisions
 * 6 Nov, 16). Ink on that colour is unchecked, so under the flag every place
 * Classic puts ink text on var(--smi-brand) switches to white on ink.
 */

const css = classicCss;
const SCOPE = '[data-site="public"]';
const TAKEOVER = '[data-site="public"][data-takeover]';

/** Every single selector of every rule, with that rule's declarations. */
const declared = rulesOf(css).flatMap((r) => selectorsOf(`${r.selector}{}`).map((selector) => ({ selector, body: r.body })));

const brandBackground = /background-color:\s*var\(--smi-brand\)/;
const inkText = /(^|[;\s])color:\s*var\(--smi-ink\)/;
const whiteOnInk = (body: string) => /background-color:\s*var\(--smi-ink\)/.test(body) && /(^|[;\s])color:\s*var\(--classic-button-text\)/.test(body);

/*
 * Discs that hold only a decorative emoji (aria-hidden, or alt text ""): their
 * ink `color` draws no text, so they keep the takeover colour.
 */
const decorativeDisc = (selector: string) => /\[data-part="page-title"\]::before$|\[data-part="join-benefit-disc"\]$/.test(selector);

const inkOnBrand = declared.filter((d) => brandBackground.test(d.body) && inkText.test(d.body) && !decorativeDisc(d.selector));
const takeoverOverride = (selector: string) =>
  declared.some((d) => d.selector === selector.replace(SCOPE, TAKEOVER) && whiteOnInk(d.body));

describe("Classic under a sponsor takeover", () => {
  it("finds the ink-on-orange rules it guards (a parse that found none would pass everything)", () => {
    const parts = inkOnBrand.map((d) => d.selector).join("\n");
    for (const part of ["button-primary", "form-submit", "site-footer-join", "home-newsroom-rank", "story-card", "featured-member-card", "newsletter-item-number", "join-step-number", "card-badge", "share-button"]) {
      expect(parts).toContain(`[data-part="${part}"]`);
    }
  });

  it("switches every rule that puts ink text on var(--smi-brand) to white on ink", () => {
    expect(inkOnBrand.filter((d) => !takeoverOverride(d.selector)).map((d) => d.selector)).toEqual([]);
  });

  // Current's SkipLink draws its ink-on-orange with utilities, not classic.css.
  it("switches the skip link too", () => {
    expect(declared.some((d) => d.selector.startsWith(`${TAKEOVER} [data-part="skip-link"]`) && whiteOnInk(d.body))).toBe(true);
  });

  it("keeps the footer band's button and focus ring visible once the band is ink", () => {
    const band = declared.filter((d) => d.selector.startsWith(`${TAKEOVER} [data-part="site-footer-join`));
    expect(band.find((d) => d.selector.endsWith(":focus-visible"))?.body).toMatch(/outline-color:\s*var\(--classic-panel\)/);
    expect(band.find((d) => d.selector.endsWith('[data-part="site-footer-join-button"]:hover'))?.body).toMatch(/background-color:\s*var\(--classic-panel\)/);
  });

  it("checks the white-on-ink pair for contrast", () => {
    const c = CLASSIC_COLOURS;
    const pairs = CLASSIC_CONTRAST_PAIRS.filter((p) => p.label.startsWith("takeover"));
    expect(pairs.map((p) => `${p.fg} on ${p.bg}`)).toContain(`${c["--classic-button-text"]} on ${c["--smi-ink"]}`);
    for (const p of pairs) expect(contrastRatio(p.fg, p.bg), p.label).toBeGreaterThanOrEqual(p.min);
  });
});

describe("classic.css colours", () => {
  it("spells white through the palette, never a bare #fff outside its declarations", () => {
    const bare = declared.filter((d) => /#fff(fff)?\b/i.test(d.body.replace(/--classic-(panel|button-text):\s*#ffffff;/g, "")));
    expect(bare.map((d) => d.selector)).toEqual([]);
  });
});
