import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkClassicSelectors, classicCss, selectorsOf, sourceParts } from "./classic-css-selectors";

/**
 * Seam 3 of the Classic design option (#68, #70): classic.css selects only what
 * the source promises to keep. Every `data-part` it targets must still be
 * labelled somewhere in src (a renamed part would otherwise unstyle a page in
 * silence), it never selects a class (Tailwind utilities change freely), and
 * every selector is scoped to the public site so /console and /dashboard are
 * out of its reach.
 */

const repo = path.resolve(__dirname, "../..");
const css = classicCss;
const parts = sourceParts(path.join(repo, "src"));

describe("classic.css selectors", () => {
  it("finds the sheet's rules (a parse that found nothing would pass everything)", () => {
    expect(selectorsOf(css).length).toBeGreaterThan(5);
  });

  it("target only data-parts that exist in src", () => {
    expect(checkClassicSelectors(css, parts).missingParts).toEqual([]);
  });

  it("use no class selectors", () => {
    expect(checkClassicSelectors(css, parts).classSelectors).toEqual([]);
  });

  it('are all scoped to [data-site="public"]', () => {
    expect(checkClassicSelectors(css, parts).unscoped).toEqual([]);
  });
});

describe("the checker", () => {
  it("reads labels from data-part and from Band/Panel's part prop", () => {
    expect(parts.has("site-main")).toBe(true); // data-part="site-main"
    expect(parts.has("home-fold")).toBe(true); // <Band part="home-fold">
  });

  it("fails on a data-part no source file labels", () => {
    const fixture = `[data-site="public"] [data-part="site-main"], [data-site="public"] [data-part='no-such-part'] { color: red; }`;
    expect(checkClassicSelectors(fixture, parts).missingParts).toEqual(["no-such-part"]);
  });

  it("fails on a Tailwind class selector, including one inside @media", () => {
    const fixture = `
      [data-site="public"] a.bg-ink { color: red; }
      @media (min-width: 40rem) { [data-site="public"] .hover\\:text-brand:hover { color: red; } }
    `;
    expect(checkClassicSelectors(fixture, parts).classSelectors).toEqual([
      '[data-site="public"] a.bg-ink',
      '[data-site="public"] .hover\\:text-brand:hover',
    ]);
  });

  it("fails on a selector outside the public-site scope", () => {
    expect(checkClassicSelectors(`main h1 { font-weight: 400; }`, parts).unscoped).toEqual(["main h1"]);
  });

  it("splits a selector list only at top-level commas, not inside :is() or an attribute value", () => {
    const fixture = `[data-site="public"] :is(h1, h2), [data-site="public"] [aria-label="a, b"] { color: red; }`;
    expect(selectorsOf(fixture)).toEqual(['[data-site="public"] :is(h1, h2)', '[data-site="public"] [aria-label="a, b"]']);
  });

  it("ignores declarations, strings, comments and keyframe steps", () => {
    const fixture = `
      /* .not-a-selector { } */
      [data-site="public"] [data-part="site-main"] {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E{}%3C/svg%3E");
        padding: 0.5rem;
      }
      @keyframes spin { 0% { opacity: 0.5; } 100% { opacity: 1; } }
    `;
    expect(selectorsOf(fixture)).toEqual(['[data-site="public"] [data-part="site-main"]']);
    expect(checkClassicSelectors(fixture, parts)).toEqual({ missingParts: [], classSelectors: [], unscoped: [] });
  });
});
