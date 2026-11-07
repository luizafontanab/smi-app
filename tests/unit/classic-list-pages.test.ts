import { describe, expect, it } from "vitest";
import { classicCss, partsTargeted, rulesOf, sectionOf, selectorsOf } from "./classic-css-selectors";

/**
 * Classic list pages (#79): /news, /video, /member, /event and /search are
 * restyled through classic.css alone. Seam 3's selector test already proves
 * every part named here exists in src; this pins what the #79 section reaches
 * (the disc-and-title head, the white panel, the 4-across grid) and what it
 * must leave alone: the filter pills' active state (class-only, so CSS can't
 * see it), pagination (#81's) and the events list (a stacked list, not a grid).
 */

const css = classicCss;

/** Innermost `selector { declarations }` pairs, comments stripped. Rules inside @media come out too. */
const listCss = sectionOf(css, "#79");
const selectors = selectorsOf(listCss);
const rules = rulesOf(listCss);

/** The outer element of each list page. */
const PAGE_ROOTS = ["news-page", "video-list-page", "member-directory", "event-list-page", "search-page"];
/** Pages whose card-grid is a real grid; /event's is a stacked list of wide cards. */
const GRID_PAGES = ["news-page", "video-list-page", "member-directory", "search-page"];

describe("Classic list pages (#79)", () => {
  it.each(PAGE_ROOTS)("turn %s into a white panel", (root) => {
    expect(selectors.some((s) => s.includes(`[data-part="${root}"]`) && s.endsWith("::before"))).toBe(true);
  });

  it.each(PAGE_ROOTS)("give %s the disc-and-title head", (root) => {
    expect(selectors.some((s) => partsTargeted(s).includes(root) && partsTargeted(s).includes("page-title") && s.endsWith("::before"))).toBe(true);
  });

  it("set a 4-across grid at desktop on every list page with a card grid", () => {
    const grid = rules.filter((r) => partsTargeted(r.selector).includes("card-grid") && /repeat\(\s*4\b/.test(r.body));
    expect(grid.length).toBeGreaterThan(0);
    for (const root of GRID_PAGES) expect(grid.some((r) => partsTargeted(r.selector).includes(root))).toBe(true);
  });

  it("leave /event's stacked list of event cards alone", () => {
    const touched = selectors.filter((s) => partsTargeted(s).includes("card-grid") && partsTargeted(s).includes("event-list-page"));
    expect(touched).toEqual([]);
  });

  it("set columns only inside a min-width media query, so phones keep one column", () => {
    const src = listCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const media = /@media[^{]*min-width[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g;
    const inMedia = [...src.matchAll(media)].map((m) => m[1]).join("\n");
    const outside = src.replace(media, "");
    expect(inMedia).toMatch(/grid-template-columns/);
    expect(outside).not.toMatch(/grid-template-columns/);
  });

  it("never recolour a filter pill's background (its active state is a class Classic can't see)", () => {
    const pills = rules.filter((r) => partsTargeted(r.selector).includes("filter-pill"));
    expect(pills.filter((r) => /background|color\s*:/.test(r.body))).toEqual([]);
  });

  it("mark the active view (List / Cloud / Map) through aria-current", () => {
    expect(selectors.some((s) => partsTargeted(s).includes("view-toggle-link") && s.includes("[aria-current"))).toBe(true);
  });

  it("leave pagination to #81", () => {
    expect(selectors.filter((s) => partsTargeted(s).some((p) => p.startsWith("pagination")))).toEqual([]);
  });

  it("reach shared parts (page-title, card-grid, section-title…) only from inside a list page", () => {
    const loose = selectors.filter((s) => !partsTargeted(s).some((p) => PAGE_ROOTS.includes(p)));
    expect(loose).toEqual([]);
  });
});
