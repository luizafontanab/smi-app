import fs from "node:fs";
import path from "node:path";

/**
 * The static checks behind tests/unit/classic/selectors.test.ts (#70), kept
 * apart so the test can prove they fail on a fixture as well as pass on the
 * real classic.css.
 *
 * Not a full CSS parser: it walks braces and quoted strings well enough to
 * collect every rule's selector list, descending into conditional at-rules
 * (@media, @supports, @container) and skipping the bodies of the rest
 * (@keyframes, @font-face).
 */

const SCOPE = '[data-site="public"]';
/** At-rules whose block holds more rules. */
const NESTING_AT_RULES = /^@(media|supports|container)\b/i;

/** Every selector in the sheet, one per comma-separated entry, whitespace collapsed. */
export function selectorsOf(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let i = 0;

  // Index just past the block that opens at `open` (src[open] === "{").
  const skipBlock = (open: number): number => {
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      const ch = src[j];
      if (ch === '"' || ch === "'") j = skipString(j);
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return j + 1;
    }
    return src.length;
  };
  const skipString = (start: number): number => {
    const quote = src[start];
    for (let j = start + 1; j < src.length; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === quote) return j;
    }
    return src.length;
  };

  const walk = (end: number) => {
    let prelude = "";
    while (i < end) {
      const ch = src[i];
      if (ch === '"' || ch === "'") {
        const close = skipString(i);
        prelude += src.slice(i, close + 1);
        i = close + 1;
      } else if (ch === ";") {
        prelude = ""; // a statement at-rule such as @import
        i++;
      } else if (ch === "}") {
        i++;
        return;
      } else if (ch === "{") {
        const head = prelude.trim().replace(/\s+/g, " ");
        prelude = "";
        if (NESTING_AT_RULES.test(head)) {
          i++;
          walk(src.length);
        } else {
          if (!head.startsWith("@")) out.push(...splitSelectorList(head));
          i = skipBlock(i);
        }
      } else {
        prelude += ch;
        i++;
      }
    }
  };
  walk(src.length);
  return out;
}

/** Split a selector list at its top-level commas: not inside (), [] or a quoted string. */
function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let j = 0; j < list.length; j++) {
    const ch = list[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, j));
      start = j + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Innermost `selector { declarations }` pairs, comments stripped. Rules inside @media come out too. */
export function rulesOf(sheet: string): { selector: string; body: string }[] {
  const src = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
}

/** The `data-part` values a selector names, from `[data-part="x"]` (any quote, any match operator). */
export function partsTargeted(selector: string): string[] {
  return [...selector.matchAll(/\[\s*data-part\s*[~|^$*]?=\s*(["']?)([^"'\]\s]+)\1\s*\]/g)].map((m) => m[2]);
}

/** True when the selector has a `.class` in it, outside attribute brackets. */
function hasClassSelector(selector: string): boolean {
  return /\.[A-Za-z_\\-]/.test(selector.replace(/\[[^\]]*\]/g, ""));
}

/**
 * Every `data-part` value labelled in source: `data-part="x"` on an element, or
 * `part="x"` on grid-home's Band and Panel, which becomes their data-part.
 */
export function sourceParts(root: string): Set<string> {
  const parts = new Set<string>();
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/\b(?:data-part|part)\s*=\s*\{?\s*["']([^"']+)["']/g)) parts.add(m[1]);
      }
    }
  };
  visit(root);
  return parts;
}

export type SelectorReport = {
  /** `data-part` values the sheet targets that no source file labels. */
  missingParts: string[];
  /** Selectors that use a class (Tailwind utilities change freely; Classic selects parts). */
  classSelectors: string[];
  /** Selectors that could reach outside the public site: no `[data-site="public"]` in them. */
  unscoped: string[];
};

export function checkClassicSelectors(css: string, partsInSource: ReadonlySet<string>): SelectorReport {
  const selectors = selectorsOf(css);
  const missing = new Set<string>();
  for (const s of selectors) for (const p of partsTargeted(s)) if (!partsInSource.has(p)) missing.add(p);
  return {
    missingParts: [...missing].sort(),
    classSelectors: selectors.filter(hasClassSelector),
    unscoped: selectors.filter((s) => !s.includes(SCOPE)),
  };
}
