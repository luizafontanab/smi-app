import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { CLASSIC_COLOURS, CLASSIC_CONTRAST_PAIRS } from "@/components/classic/palette";

/**
 * Seam 3 of the Classic design option (#68, #70): Classic's colour pairs pass
 * WCAG AA. The pairs live in one exported constant beside classic.css, and the
 * sheet's custom properties are checked against the same constant, so a colour
 * changed in one place and not the other fails here.
 */

const css = fs.readFileSync(path.resolve(__dirname, "../../../src/components/classic/classic.css"), "utf8");

describe("Classic colours", () => {
  it("are the spec's hexes (#68, decisions 6 Nov: meta grey #606060, not #666)", () => {
    expect(CLASSIC_COLOURS).toMatchObject({
      "--smi-brand": "#ff8200",
      "--smi-ink": "#111418",
      "--classic-blue": "#3100ff",
      "--classic-meta": "#606060",
      "--classic-canvas": "#e2e2e2",
      "--classic-stripe": "#dbdbdb",
      "--classic-panel": "#ffffff",
      "--classic-button-text": "#ffffff",
      "--classic-chrome": "#000000",
    });
  });

  it("are declared in classic.css with the same values", () => {
    for (const [name, hex] of Object.entries(CLASSIC_COLOURS)) {
      const declared = new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(css);
      expect(declared?.[1].toLowerCase(), name).toBe(hex);
    }
  });
});

describe("Classic contrast pairs", () => {
  it("cover every pair the spec names", () => {
    const covered = CLASSIC_CONTRAST_PAIRS.map((p) => `${p.fg} on ${p.bg}`);
    const c = CLASSIC_COLOURS;
    expect(covered).toEqual(
      expect.arrayContaining([
        `${c["--smi-ink"]} on ${c["--smi-brand"]}`, // ink on orange (also the button hover)
        `${c["--classic-meta"]} on ${c["--classic-panel"]}`,
        `${c["--classic-meta"]} on ${c["--classic-canvas"]}`,
        `${c["--classic-meta"]} on ${c["--classic-stripe"]}`,
        `${c["--classic-button-text"]} on ${c["--classic-blue"]}`,
        `${c["--classic-blue"]} on ${c["--classic-panel"]}`,
      ]),
    );
  });

  it.each(CLASSIC_CONTRAST_PAIRS)("$label: $fg on $bg reaches $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("a pair that fails would be caught: the spec's old #666 on the canvas is under 4.5:1", () => {
    expect(contrastRatio("#666666", CLASSIC_COLOURS["--classic-canvas"])).toBeLessThan(4.5);
  });
});
