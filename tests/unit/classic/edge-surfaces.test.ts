import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { partsTargeted, selectorsOf } from "./css-selectors";

/**
 * Classic edge surfaces and shared pieces (#81), restyled through classic.css
 * alone. Seam 3's selector test already proves every part named here exists in
 * src; this pins what the #81 section reaches, what it must leave alone, and
 * the two things CSS could quietly break: a sponsor takeover's colour, and the
 * sign-in, reset and unsubscribe forms.
 */

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("src/components/classic/classic.css");

function section(sheet: string, ticket: string): string {
  const start = sheet.indexOf(`/* ── ${ticket} `);
  const end = sheet.indexOf(`/* ── end ${ticket} ── */`);
  if (start < 0 || end < start) throw new Error(`no ${ticket} section in classic.css`);
  return sheet.slice(start, end);
}

/** Innermost `selector { declarations }` pairs, comments stripped. Rules inside @media come out too. */
function rulesOf(sheet: string): { selector: string; body: string }[] {
  const src = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
}

/** The body of each `@media <query> { … }` block in a sheet, comments stripped. */
function mediaBlocks(sheet: string, query: RegExp): string[] {
  const src = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...src.matchAll(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].filter((m) => query.test(m[1])).map((m) => m[2]);
}

const edgeCss = section(css, "#81");
const selectors = selectorsOf(edgeCss);
const rules = rulesOf(edgeCss);
const reaches = (part: string) => selectors.filter((s) => partsTargeted(s).includes(part));

describe("Classic edge surfaces (#81)", () => {
  describe("the root 404", () => {
    it("keeps its own small black header", () => {
      const header = rules.filter((r) => partsTargeted(r.selector).includes("not-found-header"));
      expect(header.some((r) => /background(-color)?\s*:\s*var\(--classic-chrome\)/.test(r.body))).toBe(true);
    });

    it("is styled as the page itself, apart from the public 404 inside the layout", () => {
      // Root: data-site and data-part on one element. Public: a descendant of the layout's wrapper.
      expect(selectors.some((s) => s.startsWith('[data-site="public"][data-part="not-found"]'))).toBe(true);
      expect(selectors.some((s) => s.startsWith('[data-site="public"] [data-part="not-found"]'))).toBe(true);
    });

    it("stays database-free: it imports only next/link and the design-option stylesheet", () => {
      const imports = [...read("src/app/not-found.tsx").matchAll(/^import\s[^;]*?["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(imports.sort()).toEqual(["@/components/design-option", "next/link"]);
    });
  });

  it.each(["error-page", "loading-skeleton", "cookie-banner", "skip-link", "industry-strip", "takeover-banner", "ad-placeholder", "supplier-logos", "pagination", "auth-panel"])(
    "restyle %s",
    (part) => {
      expect(reaches(part).length).toBeGreaterThan(0);
    },
  );

  it("stop the loading skeleton's pulse under reduced motion", () => {
    const reduce = mediaBlocks(edgeCss, /prefers-reduced-motion:\s*reduce/).join("\n");
    expect(rulesOf(reduce).some((r) => partsTargeted(r.selector).includes("loading-skeleton") && /animation\s*:\s*none/.test(r.body))).toBe(true);
  });

  describe("pagination", () => {
    it("reaches its links only inside a pagination nav, so the calendar's month arrows and member videos keep theirs", () => {
      const loose = reaches("pagination-link").filter((s) => !partsTargeted(s).includes("pagination"));
      expect(loose).toEqual([]);
      expect(reaches("pagination-link").length).toBeGreaterThan(0);
    });

    it("draws the links as blue buttons", () => {
      const links = rules.filter((r) => partsTargeted(r.selector).includes("pagination-link") && !r.selector.includes(":hover"));
      expect(links.some((r) => /background-color\s*:\s*var\(--classic-blue\)/.test(r.body))).toBe(true);
    });
  });

  describe("the /news supplier logos", () => {
    it("bleed to the panel's edge at md and up, by exactly the padding #79 gives the panel there", () => {
      const listPadding = mediaBlocks(section(css, "#79"), /min-width:\s*48rem/).join("\n");
      const inset = /padding\s*:\s*0\s+(\S+)/.exec(listPadding)?.[1];
      expect(inset).toBeDefined();
      const md = rulesOf(mediaBlocks(edgeCss, /min-width:\s*48rem/).join("\n"));
      const bleed = md.find((r) => partsTargeted(r.selector).includes("news-page") && partsTargeted(r.selector).includes("supplier-logos-wrap"));
      expect(bleed?.body).toMatch(new RegExp(`margin-inline\\s*:\\s*-${inset}\\b`));
    });

    it("leave the home page's supplier band to #73", () => {
      const supplier = selectors.filter((s) => partsTargeted(s).some((p) => p.startsWith("supplier-logo")));
      expect(supplier.filter((s) => !partsTargeted(s).includes("supplier-logos-wrap"))).toEqual([]);
    });
  });

  describe("a sponsor takeover's colour", () => {
    // The layout sets the takeover hex as an inline --smi-brand on the same
    // element that carries data-site="public". An inline declaration outranks
    // any normal stylesheet declaration on that element, whatever its
    // specificity, and descendants inherit it. So the takeover wins as long as
    // classic.css (1) sets --smi-brand only on that wrapper, (2) never with
    // !important, and (3) reads orange through var(--smi-brand) everywhere else.
    it("is set inline on the element that carries data-site=\"public\"", () => {
      const layout = read("src/app/(public)/layout.tsx");
      expect(layout).toMatch(/"--smi-brand":\s*takeover\.hex/);
      expect(layout).toMatch(/<div data-site="public"[^>]*\sstyle=\{style\}/);
    });

    it("is overridden in classic.css only on that wrapper, never on a descendant", () => {
      const setters = rulesOf(css).filter((r) => /--smi-brand\s*:/.test(r.body));
      expect(setters.map((r) => r.selector)).toEqual(['[data-site="public"]']);
    });

    it("is never outranked with !important", () => {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/!\s*important/i);
    });

    it("is never bypassed by a literal orange", () => {
      const literals = rulesOf(css).filter((r) => /#ff8200|#f39224/i.test(r.body) && !/--smi-brand\s*:\s*#ff8200\s*;/i.test(r.body));
      expect(literals).toEqual([]);
    });
  });

  it("never hide, disable or block a form control (sign-in, reset and unsubscribe must keep working)", () => {
    const formish = rulesOf(css).filter((r) => partsTargeted(r.selector).some((p) => p.startsWith("auth-") || p.startsWith("form-")));
    const blocking = /display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none|opacity\s*:\s*0(\.0*)?\s*[;}]|content-visibility\s*:\s*hidden/;
    expect(formish.filter((r) => blocking.test(r.body))).toEqual([]);
    expect(rules.filter((r) => blocking.test(r.body))).toEqual([]);
  });
});
