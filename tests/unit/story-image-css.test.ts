import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Positioned story images (lib/image-layout) must never be stretched past
 * their own pixels — `width: 100%` (and the 33/50/66% shares) blew a small
 * logo or a low-res photo up to the column and left it soft (review, 16 Oct).
 * Only "Full width" means span the column. jsdom computes no layout, so this
 * reads the rules themselves out of globals.css.
 */
const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every leaf rule (inside @media or not) whose selector touches a positioned story image. */
const imageRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }))
  .filter((r) => r.selector.includes(".story-body img[data-align"));

const widthOf = (body: string) => /(?:^|;)\s*width\s*:\s*([^;]+)/.exec(body)?.[1].trim() ?? null;

describe("story image sizing (globals.css)", () => {
  it("finds the rules it is guarding", () => {
    expect(imageRules.length).toBeGreaterThanOrEqual(4);
  });

  it("only Full width sets a stretching width; every share is a max-width cap", () => {
    for (const { selector, body } of imageRules) {
      const width = widthOf(body);
      if (width === null || width === "auto") continue;
      expect(selector, `${selector} sets width: ${width}`).toMatch(/^\.story-body img\[data-align="full"\]$/);
    }
  });

  it("caps each floated share at its size", () => {
    const capFor = (size: string | null) =>
      imageRules.find((r) => r.selector.includes('[data-align="left"]') && (size ? r.selector.includes(`[data-size="${size}"]`) : !r.selector.includes("data-size")) && /max-width/.test(r.body));
    expect(capFor(null)?.body).toMatch(/max-width:\s*50%/);
    expect(capFor("small")?.body).toMatch(/max-width:\s*33%/);
    expect(capFor("large")?.body).toMatch(/max-width:\s*66%/);
  });
});
