import { describe, expect, it } from "vitest";
import { DEFAULT_FOCUS, focusStyle, focusVars, parseFocus } from "@/lib/focus";

/**
 * cover_focus is jsonb written by a client control, so parseFocus is the only
 * thing standing between a hand-edited row and a broken layout. The rule that
 * actually matters for regression safety is the last describe block: an
 * untouched story must render exactly as it did before focus existed.
 */

describe("parseFocus", () => {
  it("centres anything that isn't a focus object", () => {
    for (const bad of [null, undefined, "", "{}", 3, [], [0.5, 0.5], true]) {
      expect(parseFocus(bad)).toEqual(DEFAULT_FOCUS);
    }
  });

  it("fills in missing keys individually", () => {
    expect(parseFocus({ x: 0.2 })).toEqual({ x: 0.2, y: 0.5, scale: 1 });
    expect(parseFocus({ scale: 1.5 })).toEqual({ x: 0.5, y: 0.5, scale: 1.5 });
  });

  it("reads numeric strings — FormData round-trips everything as text", () => {
    expect(parseFocus({ x: "0.25", y: "0.75", scale: "1.4" })).toEqual({ x: 0.25, y: 0.75, scale: 1.4 });
  });

  it("clamps out-of-range values rather than rejecting them", () => {
    expect(parseFocus({ x: -3, y: 42, scale: 99 })).toEqual({ x: 0, y: 1, scale: 2 });
    expect(parseFocus({ x: 0.5, y: 0.5, scale: 0.1 })).toEqual({ x: 0.5, y: 0.5, scale: 1 });
  });

  it("ignores non-finite numbers", () => {
    expect(parseFocus({ x: NaN, y: Infinity, scale: "banana" })).toEqual(DEFAULT_FOCUS);
  });
});

describe("focusStyle", () => {
  it("pans with object-position", () => {
    expect(focusStyle({ x: 0.25, y: 0.75, scale: 1 })).toEqual({ objectPosition: "25% 75%" });
  });

  it("anchors the zoom on the focal point, so the subject stays put", () => {
    expect(focusStyle({ x: 0.25, y: 0.75, scale: 1.5 })).toEqual({
      objectPosition: "25% 75%",
      transform: "scale(1.5)",
      transformOrigin: "25% 75%",
    });
  });

  it("adds no transform at scale 1 — nothing to fight a hover or animation rule", () => {
    expect(focusStyle(null)).toEqual({ objectPosition: "50% 50%" });
    expect(focusStyle(null)).not.toHaveProperty("transform");
  });
});

describe("focusVars", () => {
  it("hands the hero its zoom as a custom property, not a transform", () => {
    expect(focusVars({ x: 0.4, y: 0.2, scale: 1.25 })).toEqual({
      objectPosition: "40% 20%",
      transformOrigin: "40% 20%",
      "--focus-scale": "1.25",
    });
  });

  it("omits the property at scale 1 so the CSS fallback of 1 applies", () => {
    expect(focusVars({ x: 0.5, y: 0.5, scale: 1 })).toEqual({ objectPosition: "50% 50%" });
  });
});
