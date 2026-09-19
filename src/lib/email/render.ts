/**
 * The template engine behind every email: token substitution, escaping and the
 * save-time validation the console runs before it will store an edit.
 *
 * Copy used to be JavaScript — `` `Your advert run ends on ${payload.ends_on}` ``
 * — so changing a word was a code change and a deploy. It is now authored text
 * with `{{token}}` placeholders, which means the substitution rules below are
 * the whole safety boundary: an admin writes the markup, but never supplies the
 * values, and a member's own words never become markup.
 */

export type TemplateVars = Record<string, string>;

/**
 * Deliberately does NOT match the triple-brace form. Resend's own
 * `{{{RESEND_UNSUBSCRIBE_URL}}}` appears verbatim in the newsletter wrapper,
 * and a naive `/\{\{(\w+)\}\}/` matches the *inner* two braces of it — leaving
 * a stray `{`, a substituted middle and a dead unsubscribe link. That is a
 * PECR problem, not a cosmetic one, so the lookarounds are load-bearing.
 */
const TOKEN = /(?<!\{)\{\{\s*([a-zA-Z0-9_]+)\s*\}\}(?!\})/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Every `{{token}}` in `source`, in order, deduplicated. */
export function tokensIn(source: string): string[] {
  return [...new Set(Array.from(source.matchAll(TOKEN), (m) => m[1]))];
}

type InterpolateOptions = {
  /** HTML-escape every substituted value except those named in `raw`. Off for the text variant. */
  escape?: boolean;
  /** Tokens whose value is already markup — the shell's `{{body}}`, the newsletter's `{{items}}`. */
  raw?: readonly string[];
};

/**
 * Whitelist-only and single-pass. A token with no value is left **verbatim**
 * rather than blanked, so an unrecognised `{{…}}` in authored copy survives to
 * be seen instead of silently deleting itself. `String.replace` with a function
 * callback never rescans its own output, so a value containing `{{x}}` cannot
 * trigger a second round of substitution.
 */
export function interpolate(
  source: string,
  vars: TemplateVars,
  { escape = false, raw = [] }: InterpolateOptions = {},
): string {
  return source.replace(TOKEN, (match, name: string) => {
    if (!Object.hasOwn(vars, name)) return match;
    const value = vars[name];
    return escape && !raw.includes(name) ? escapeHtml(value) : value;
  });
}

/**
 * Drops paragraphs that interpolated away to nothing.
 *
 * The copy this replaced ended several kinds with `.filter(Boolean)` — the
 * receipt has no "Your reference is …" line when there is no reference. Since a
 * whole optional sentence is now one token, an absent value leaves an empty
 * paragraph rather than an absent one, and this puts that back.
 */
export function dropEmptyParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*>\s*<\/p>\s*/g, "");
}

/** The plain-text counterpart: collapse runs of blank lines and trim the ends. */
export function collapseBlankLines(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Gmail clips a message around 102 KB and the clip is invisible while you are
 * authoring, so the cap is well under it.
 */
export const MAX_TEMPLATE_BYTES = 64 * 1024;

export type TemplateValidationInput = {
  /** Every token this template is allowed to use. */
  allowed: readonly string[];
  /** Tokens the template stops working without — the shell's `{{body}}`, say. */
  required?: readonly string[];
  /** Field label → authored source, for the message. */
  fields: Record<string, string | null | undefined>;
};

/**
 * Returns a human message, or null when the template is sound.
 *
 * A mistyped token is a hard error rather than a warning on purpose: left to
 * render, `{{ends_onn}}` reaches the member as literal braces in a sentence,
 * and whoever wrote it has no way to find out.
 */
export function validateTemplate({ allowed, required = [], fields }: TemplateValidationInput): string | null {
  for (const [label, source] of Object.entries(fields)) {
    if (!source) continue;

    if (Buffer.byteLength(source, "utf8") > MAX_TEMPLATE_BYTES) {
      return `The ${label} is too long — keep it under ${MAX_TEMPLATE_BYTES / 1024} KB so email clients don't cut it off.`;
    }

    const unknown = tokensIn(source).filter((token) => !allowed.includes(token));
    if (unknown.length) {
      return `The ${label} uses ${unknown.map((t) => `{{${t}}}`).join(", ")}, which this email doesn't have. Use one of the placeholders listed alongside the field.`;
    }
  }

  const combined = Object.values(fields).filter(Boolean).join("\n");
  const missing = required.filter((token) => !tokensIn(combined).includes(token));
  if (missing.length) {
    return `This template can't leave out ${missing.map((t) => `{{${t}}}`).join(", ")} — without it the email sends with nothing in it.`;
  }

  return null;
}
