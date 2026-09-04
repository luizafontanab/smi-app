/**
 * Turns heading-structured body HTML into <details>/<summary> sections for
 * pages flagged `collapsible` (Policies, FAQ — fix-list 7/13).
 *
 * MUST run on sanitised HTML (renderableHtml output), never on the raw row:
 * <details>/<summary>/<div> are not in RICH_TEXT_ALLOWLIST, so this transform
 * happens after sanitisation and its output goes straight to the renderer.
 * Everything inside the emitted markup came out of the sanitiser; the only
 * additions are our own literal tags with fixed class strings.
 *
 * Sectioning model is FLAT: every <h2> or <h3> starts a new top-level section,
 * so an <h3> after an <h2> closes the h2's card and opens its own — h3s never
 * nest inside an h2's <details>. Console-authored pages use one heading level
 * per page in practice, and flat sections keep the transform a simple linear
 * split with no bracket-matching to get wrong on imported HTML.
 *
 * Purely a string transform — a heading with no matching close tag simply
 * doesn't match and stays put, so malformed HTML degrades to "not collapsed"
 * rather than throwing.
 */

// White-card styling to match the .story-read article look (see the
// non-collapsible branch of /pages/[slug]: rounded-lg bg-white shadow-sm).
const DETAILS_CLASS = "mt-3 rounded-lg bg-white p-5 shadow-sm";
const SUMMARY_CLASS = "cursor-pointer select-none font-bold text-ink";
const CONTENT_CLASS = "mt-2";

// Sanitised headings carry no attributes, but tolerate them anyway — this may
// see HTML from tests or future allowlist changes. Backreference \1 keeps
// <h2>…</h3> mismatches from matching.
const HEADING = /<h([23])(?:\s[^>]*)?>([\s\S]*?)<\/h\1\s*>/gi;

/**
 * Rewrites each h2/h3-headed section of `html` as
 * `<details><summary>heading</summary><div>section content</div></details>`.
 * Content before the first heading (the preamble) is left untouched; heading
 * inner HTML (e.g. <strong>) is preserved in the summary. HTML with no
 * h2/h3 headings is returned unchanged.
 */
export function collapseSections(html: string): string {
  const matches = [...html.matchAll(HEADING)];
  if (matches.length === 0) return html;

  let out = html.slice(0, matches[0].index);
  matches.forEach((m, i) => {
    const contentStart = m.index + m[0].length;
    const contentEnd = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const content = html.slice(contentStart, contentEnd).trim();
    out +=
      `<details class="${DETAILS_CLASS}"><summary class="${SUMMARY_CLASS}">${m[2]}</summary>` +
      (content ? `<div class="${CONTENT_CLASS}">${content}</div>` : "") +
      `</details>`;
  });
  return out;
}
