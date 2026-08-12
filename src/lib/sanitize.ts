import sanitizeHtml from "sanitize-html";

const MEDIA_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/`;

/**
 * The full rich-text vocabulary the editor can produce and .story-body styles.
 * Applied on every write AND every render — old rows are cleaned at render time.
 */
export const RICH_TEXT_ALLOWLIST: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h2", "h3", "strong", "em", "u", "s", "a", "ul", "ol", "li", "br", "blockquote", "img"],
  allowedAttributes: {
    a: ["href", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener nofollow" }),
  },
  exclusiveFilter: (frame) =>
    // images may only come from our own public media bucket
    frame.tag === "img" && !String(frame.attribs.src ?? "").startsWith(MEDIA_PREFIX),
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_ALLOWLIST).trim();
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text (blank-line paragraphs) → safe rich-text HTML. */
export function richTextFromPlain(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`).join("");
}

/**
 * Legacy-tolerant renderer input: rows written before the editor may hold
 * plain text. HTML-looking values are sanitised; anything else is escaped
 * and paragraph-wrapped. Converges to pure HTML as content is re-saved.
 */
export function renderableHtml(text: string | null | undefined): string {
  if (!text) return "";
  return /^\s*</.test(text) ? sanitizeRichText(text) : richTextFromPlain(text);
}

/** The entities WordPress bodies actually carry; anything else becomes a space. */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#039;": "'", "&#8216;": "‘", "&#8217;": "’", "&#8220;": "“", "&#8221;": "”",
  "&#8211;": "–", "&#8212;": "—", "&hellip;": "…",
};

/**
 * Stored rich text → a plain-text excerpt for list views, where imported
 * bodies (up to ~10k chars of WordPress HTML) would otherwise dominate.
 */
export function excerptFromHtml(html: string | null | undefined, max = 220): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}
