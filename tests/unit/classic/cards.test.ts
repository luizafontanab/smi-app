import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { partsTargeted, selectorsOf } from "./css-selectors";

/**
 * Classic cards (#75): the shared cards are restyled through classic.css alone,
 * never forked. Seam 3's selector test already proves every part named here
 * still exists in src; this pins which cards the #75 section reaches, and that
 * its generic card parts (title, meta, image…) stay inside a card, so a page
 * heading or list that reuses `card-title` isn't swept up.
 */

const css = fs.readFileSync(path.resolve(__dirname, "../../../src/components/classic/classic.css"), "utf8");

function section(sheet: string, ticket: string): string {
  const start = sheet.indexOf(`/* ── ${ticket} `);
  const end = sheet.indexOf(`/* ── end ${ticket} ── */`);
  if (start < 0 || end < start) throw new Error(`no ${ticket} section in classic.css`);
  return sheet.slice(start, end);
}

const cardSelectors = selectorsOf(section(css, "#75"));
const targeted = new Set(cardSelectors.flatMap(partsTargeted));

/** The outer element of each shared card (story, video, event, member tile, featured member) plus search's member card. */
const CARD_ROOTS = ["story-card", "video-card", "event-card", "member-tile", "featured-member-card", "search-member-card"];

describe("Classic cards (#75)", () => {
  it.each(CARD_ROOTS)("restyle %s", (root) => {
    expect(targeted).toContain(root);
  });

  it.each(["card-title", "card-meta", "card-image", "card-badge", "card-play"])("restyle the %s part", (part) => {
    expect(targeted).toContain(part);
  });

  it("reach card parts only from inside a card", () => {
    const loose = cardSelectors.filter((s) => {
      const parts = partsTargeted(s);
      return parts.some((p) => p.startsWith("card-")) && !parts.some((p) => CARD_ROOTS.includes(p));
    });
    expect(loose).toEqual([]);
  });
});
