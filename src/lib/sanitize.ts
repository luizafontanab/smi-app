import sanitizeHtml from "sanitize-html";
import { IMAGE_ALIGNS, IMAGE_SIZES } from "@/lib/image-layout";

const MEDIA_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/`;

/**
 * The full rich-text vocabulary the editor can produce and .story-body styles.
 * Applied on every write AND every render — old rows are cleaned at render time.
 */
export const RICH_TEXT_ALLOWLIST: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h2", "h3", "strong", "em", "u", "s", "a", "ul", "ol", "li", "br", "blockquote", "img", "hr"],
  allowedAttributes: {
    a: ["href", "rel"],
    // data-align / data-size are value-checked in transformTags.img below.
    img: ["src", "alt", "width", "height", "data-align", "data-size"],
    hr: ["data-ad-break"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener nofollow" }),
    // Image layout (lib/image-layout): only the enumerated values survive, and a
    // bad one removes the attribute outright. (sanitize-html's own `values`
    // option would leave an empty `data-align` behind, which still matches an
    // attribute selector.)
    img: (tagName, attribs) => {
      const { "data-align": align, "data-size": size, ...rest } = attribs;
      return {
        tagName,
        attribs: {
          ...rest,
          ...((IMAGE_ALIGNS as readonly string[]).includes(align) ? { "data-align": align } : {}),
          ...((IMAGE_SIZES as readonly string[]).includes(size) ? { "data-size": size } : {}),
        },
      };
    },
  },
  exclusiveFilter: (frame) =>
    // images may only come from our own public media bucket
    (frame.tag === "img" && !String(frame.attribs.src ?? "").startsWith(MEDIA_PREFIX)) ||
    // `hr` exists solely to carry the advert break; a bare rule is not content.
    // Without this, any <hr> in an imported body would quietly become ad inventory.
    (frame.tag === "hr" && frame.attribs["data-ad-break"] === undefined),
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
 *
 * Detects a real tag anywhere in the string, not just a leading one — a
 * legacy row can be mostly plain text with one inline tag typed partway
 * through (e.g. "Founded in 1990, <strong>we</strong> specialise in..."),
 * which a leading-`<` check would miss and then escape into literal text.
 */
const HTML_TAG_RE = new RegExp(`<\\/?(?:${(RICH_TEXT_ALLOWLIST.allowedTags as string[]).join("|")})\\b`, "i");

function sanitisedOrWrapped(text: string | null | undefined): string {
  if (!text) return "";
  return HTML_TAG_RE.test(text) ? sanitizeRichText(text) : richTextFromPlain(text);
}

/**
 * The author-placed advert break, as it survives the sanitiser. Matching the
 * sanitised form (never raw input) keeps this deterministic: the allowlist
 * permits exactly one attribute on `hr`, so there is no ordering to guess.
 */
const AD_BREAK = /<hr\b[^>]*\bdata-ad-break\b[^>]*>/gi;

/** Breaks a single body may honour — readers must not be drowned in adverts. */
export const MAX_AD_BREAKS = 2;

/**
 * Legacy-tolerant renderer input for everything that is NOT a split story body.
 * Advert breaks are meaningless outside one (member profiles, machine listings,
 * static pages all render through here), so they are dropped rather than left
 * to show as a stray rule.
 */
export function renderableHtml(text: string | null | undefined): string {
  return sanitisedOrWrapped(text).replace(AD_BREAK, "").trim();
}

/**
 * Story body → the segments to render between advert breaks; one entry means
 * no break. Empty segments are dropped, which is what collapses a leading
 * break (no page may open with an advert), a trailing one (the layout already
 * ends with a footer advert) and two adjacent markers.
 *
 * Enforced at render, not on write, so the rules hold whatever is in the row —
 * the same reason the sanitiser itself runs on both paths.
 */
export function splitAtAdBreaks(text: string | null | undefined, max = MAX_AD_BREAKS): string[] {
  const segments = sanitisedOrWrapped(text).split(AD_BREAK).map((s) => s.trim()).filter(Boolean);
  // surplus markers fold back into the tail rather than dropping the copy after them
  return segments.length - 1 > max ? [...segments.slice(0, max), segments.slice(max).join("")] : segments;
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
