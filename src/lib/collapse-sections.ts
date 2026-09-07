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
 * Sectioning model is TWO-LEVEL: every <h2> starts a new top-level card, and
 * any <h3> inside its span becomes its own nested <details> rather than a
 * sibling — Policies genuinely nests "Account/Login/Forms/Site preferences
 * cookies" under "The Cookies We Set" (fix-list 13), and a page with no h3s
 * (FAQ) collapses exactly as a flat one would.
 *
 * Purely a string transform — a heading with no matching close tag simply
 * doesn't match and stays put, so malformed HTML degrades to "not collapsed"
 * rather than throwing. A page with h3s but no h2 at all doesn't collapse
 * either (there's nothing to key the outer sections off); not a real case
 * today — every collapsible page uses h2 for its top level.
 */

// White-card styling to match the .story-read article look (see the
// non-collapsible branch of /pages/[slug]: rounded-lg bg-white shadow-sm).
const DETAILS_CLASS = "mt-3 rounded-lg bg-white p-5 shadow-sm";
// Subordinate to the card above it: inset background, no shadow of its own.
const NESTED_DETAILS_CLASS = "mt-2 rounded-lg bg-paper p-4";
const SUMMARY_CLASS = "cursor-pointer select-none font-bold text-ink";
const CONTENT_CLASS = "mt-2";

// Sanitised headings carry no attributes, but tolerate them anyway — this may
// see HTML from tests or future allowlist changes.
const H2 = /<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2\s*>/gi;
const H3 = /<h3(?:\s[^>]*)?>([\s\S]*?)<\/h3\s*>/gi;

/**
 * Rewrites each h2-headed section of `html` as
 * `<details><summary>heading</summary>…</details>`, recursing into any h3s
 * within that section via collapseSubsections. Content before the first h2
 * (the preamble) is left untouched; heading inner HTML (e.g. <strong>) is
 * preserved in the summary. HTML with no h2 headings is returned unchanged.
 */
export function collapseSections(html: string): string {
  const sections = [...html.matchAll(H2)];
  if (sections.length === 0) return html;

  let out = html.slice(0, sections[0].index);
  sections.forEach((m, i) => {
    const contentStart = m.index + m[0].length;
    const contentEnd = i + 1 < sections.length ? sections[i + 1].index : html.length;
    out +=
      `<details class="${DETAILS_CLASS}"><summary class="${SUMMARY_CLASS}">${m[1]}</summary>` +
      collapseSubsections(html.slice(contentStart, contentEnd)) +
      `</details>`;
  });
  return out;
}

/** h3s within one h2's span nest as their own <details>; content before the first h3 stays a plain block. */
function collapseSubsections(html: string): string {
  const subsections = [...html.matchAll(H3)];
  if (subsections.length === 0) {
    const content = html.trim();
    return content ? `<div class="${CONTENT_CLASS}">${content}</div>` : "";
  }

  const lead = html.slice(0, subsections[0].index).trim();
  let out = lead ? `<div class="${CONTENT_CLASS}">${lead}</div>` : "";
  subsections.forEach((m, i) => {
    const contentStart = m.index + m[0].length;
    const contentEnd = i + 1 < subsections.length ? subsections[i + 1].index : html.length;
    const content = html.slice(contentStart, contentEnd).trim();
    out +=
      `<details class="${NESTED_DETAILS_CLASS}"><summary class="${SUMMARY_CLASS}">${m[1]}</summary>` +
      (content ? `<div class="${CONTENT_CLASS}">${content}</div>` : "") +
      `</details>`;
  });
  return out;
}
