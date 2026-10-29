import * as cheerio from "cheerio";
import { sanitizeRichText } from "@/lib/sanitize";

/**
 * Pure parsing for "Start story" (/console/sources → Suggested): one article
 * page → the parts a draft is pre-loaded with. Nothing here touches the
 * network or the database; it is tested against fixture strings.
 *
 * The body is the article's own text, kept as headings, paragraphs, lists and
 * links, then put through sanitizeRichText — the same allowlist every story
 * body passes on save, which also drops images that aren't in our bucket.
 */

export type Article = {
  title: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  bodyHtml: string;
};

/** Never part of an article's text, wherever they sit on the page. */
const CLUTTER_TAGS = "script, style, noscript, svg, form, iframe, nav, footer, aside, button, select, input, [role=navigation], [aria-hidden=true]";

/**
 * Widgets inside a post body, matched by class/id. Only applied inside the
 * chosen body: themes put words like "sidebar" on <body> itself
 * ("et_right_sidebar"), and stripping those page-wide removed the article.
 */
const CLUTTER_WIDGETS = [
  "[class*=share]", "[class*=social]", "[class*=cookie]", "[class*=related]", "[class*=comment]",
  "[class*=breadcrumb]", "[class*=newsletter]", "[class*=sidebar]", "[class*=author-bio]", "[class*=post-nav]",
  "[class*=post-meta]", "[id*=cookie]", "[id*=comments]", "[id*=sidebar]",
].join(",");

/** Containers themes use for the post body, most specific first. */
const BODY_SELECTORS = [
  "[itemprop=articleBody]", ".entry-content", ".post-content", ".article-content", ".article-body",
  ".post-body", ".blog-content", ".news-content", "article", "main", "[role=main]", "#content",
];

/** A paragraph shorter than this is a caption, a date or a button label, not text. */
const MIN_PARAGRAPH = 40;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

function meta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const name of names) {
    const value = $(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content");
    if (value && tidy(value)) return tidy(value);
  }
  return null;
}

function absolute(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The element holding the article text: the first known body container that
 * actually has paragraphs, else the element with the most paragraph text
 * directly inside it (the "densest cluster" — themes with no semantic markup).
 */
function bodyRoot($: cheerio.CheerioAPI) {
  const isText = (p: Parameters<typeof $>[0]) => tidy($(p).text()).length >= MIN_PARAGRAPH;
  for (const selector of BODY_SELECTORS) {
    const found = $(selector).toArray().find((el) => $(el).find("p").toArray().some(isText));
    if (found) return $(found);
  }
  // Each distinct parent of a paragraph, scored by the real paragraphs directly inside it.
  const scored = $("p").parent().toArray().map((el) => ({
    el,
    score: $(el).children("p").toArray().filter(isText).reduce((sum, p) => sum + tidy($(p).text()).length, 0),
  }));
  const best = scored.reduce<(typeof scored)[number] | null>((top, c) => (c.score > (top?.score ?? 0) ? c : top), null);
  return best ? $(best.el) : null;
}

/**
 * "Six-figure grant helps Brandauer… - Brandauer" → without the site name.
 * After " | " the tail is always the site; after a dash only when it names the
 * site (og:site_name or the domain), since a dash is also ordinary punctuation.
 */
export function withoutSiteName(title: string, siteName: string | null, pageUrl: string): string | null {
  const clean = tidy(title);
  if (!clean) return null;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const host = squash(new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0]);
  const site = siteName ? squash(siteName) : null;
  const m = /^(.{15,}?)\s+(\||-|–|—|::|»)\s+([^|–—-]{1,60})$/.exec(clean);
  if (!m) return clean;
  const tail = squash(m[3]);
  const namesSite = !!tail && (tail === site || tail === host || host.startsWith(tail) || tail.startsWith(host) || (site !== null && site.startsWith(tail)));
  return m[2] === "|" || namesSite ? m[1].trim() : clean;
}

export function parseArticle(html: string, pageUrl: string): Article {
  const $ = cheerio.load(html);
  const title = withoutSiteName(meta($, "og:title", "twitter:title") ?? tidy($("title").first().text()), meta($, "og:site_name"), pageUrl);
  const excerpt = meta($, "og:description", "description", "twitter:description");
  const imageUrl = absolute(meta($, "og:image", "og:image:url", "twitter:image") ?? undefined, pageUrl);

  $(CLUTTER_TAGS).remove();
  const root = bodyRoot($);
  if (!root) return { title, excerpt, imageUrl, bodyHtml: "" };
  root.find(CLUTTER_WIDGETS).remove();

  // The story has its own title field: a heading repeating it would print twice.
  const titleKey = title ? tidy(title).toLowerCase() : null;
  root.find("h1, h2").each((_, h) => {
    const text = tidy($(h).text()).toLowerCase();
    if (text && titleKey && (titleKey.startsWith(text) || text.startsWith(titleKey))) $(h).remove();
  });
  // The editor's vocabulary: h2/h3 only, strong/em, links made absolute so
  // they still work once the text lives on our site.
  root.find("h1").each((_, el) => { el.tagName = "h2"; });
  root.find("h4, h5, h6").each((_, el) => { el.tagName = "h3"; });
  root.find("b").each((_, el) => { el.tagName = "strong"; });
  root.find("i").each((_, el) => { el.tagName = "em"; });
  root.find("a").each((_, a) => {
    const href = absolute($(a).attr("href"), pageUrl);
    if (href) $(a).attr("href", href);
    else $(a).replaceWith($(a).contents());
  });
  // Empty paragraphs (spacers) carry nothing.
  root.find("p").each((_, p) => { if (!tidy($(p).text())) $(p).remove(); });

  return { title, excerpt, imageUrl, bodyHtml: sanitizeRichText(root.html() ?? "") };
}

const LEGAL_SUFFIX = /[\s,]+(ltd\.?|limited|plc|llp|inc\.?|co\.?|uk|\(uk\))$/i;

/** "Acme Fabrication Ltd" → ["Acme Fabrication Ltd", "Acme Fabrication"]: articles rarely use the legal name. */
export function nameVariants(name: string): string[] {
  const variants = [tidy(name)];
  let short = variants[0];
  while (LEGAL_SUFFIX.test(short)) {
    short = short.replace(LEGAL_SUFFIX, "");
    variants.push(short);
  }
  return [...new Set(variants)].filter((v) => v.length >= 3);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Just enough of the parsed tree to walk it; cheerio's own node types live in a package we don't depend on. */
type WalkNode = { type: string; data?: string; tagName?: string; children?: WalkNode[] };

/**
 * Link the first mention of a company in the article text to its member page —
 * what Jas does by hand ("I would build links into that page", DESIGN-QUOTES
 * §13). Only body text counts: never inside an existing link, never in a
 * heading. Returns the html unchanged when the name doesn't appear.
 */
export function linkFirstMention(html: string, name: string, href: string): string {
  const $ = cheerio.load(html, null, false);
  for (const variant of nameVariants(name)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(variant)})(?![\\p{L}\\p{N}])`, "u");
    const find = (nodes: WalkNode[]): { node: WalkNode; m: RegExpExecArray } | null => {
      for (const node of nodes) {
        if (node.type === "text") {
          const m = re.exec(node.data ?? "");
          if (m) return { node, m };
        } else if (node.type === "tag" && !["a", "h2", "h3"].includes(node.tagName ?? "")) {
          const hit = find(node.children ?? []);
          if (hit) return hit;
        }
      }
      return null;
    };
    const hit = find($.root().contents().toArray() as unknown as WalkNode[]);
    if (!hit) continue;
    const text = hit.node.data ?? "";
    const start = hit.m.index + hit.m[1].length;
    const end = start + hit.m[2].length;
    $(hit.node as never).replaceWith(
      `${escapeHtml(text.slice(0, start))}<a href="${escapeHtml(href)}">${escapeHtml(hit.m[2])}</a>${escapeHtml(text.slice(end))}`,
    );
    return $.html();
  }
  return html;
}
