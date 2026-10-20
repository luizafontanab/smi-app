import * as cheerio from "cheerio";

/**
 * Pure parsing for the story-sources watcher (ChangeTower replacement,
 * requirements/06-content-os.md). Everything here turns a fetched body into
 * candidate articles; nothing touches the network or the database, so it is
 * tested directly against fixture strings.
 *
 * The HTML listing reader is the prototype in /SMI/content-sources/scraper
 * (src/extract.ts) ported nearly as-is — its heuristics are what the October
 * 2026 coverage test measured (docs/story-sources.md).
 */

export type FoundItem = { url: string; title: string; publishedAt: string | null };

// Only strip tags that are never a legitimate per-article wrapper. Themes
// commonly reuse <header>/<footer> as a per-post title/meta wrapper inside a
// listing card, so those are NOT stripped globally — only `nav`, and only
// inside the chosen root.
const GLOBAL_NOISE_SELECTORS = ["script", "style", "noscript", "svg", "form"];
const MAIN_SELECTORS = ["main", "#content", ".content", "article", "#main", ".main"];
const GENERIC_LINK_TEXT = /^(home|about|contact( us)?|next|previous|prev|read more|continue reading|login|log in|sign in|subscribe|share|more|view all|see all|\d+)$/i;

/**
 * Paths that are almost never news: the coverage test's one "new article"
 * was a job vacancy, and listing pages link to their own tags, pagination and
 * shop. Applied to every method, feeds included (a site-wide feed carries
 * product pages on some sites).
 */
const NOT_AN_ARTICLE = /\/(careers?|vacanc(y|ies)|jobs?|recruitment|tag|tags|category|categories|author|page\/\d+|login|my-account|account|contact(-us)?|privacy|cookies?|terms|cart|basket|checkout|shop|products?|search|feed)(\/|$|\?)|[?&](page|paged|s)=|\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?)$/i;

/** Text a bot-protection interstitial shows instead of the page. */
const CHALLENGE = /just a moment|attention required|checking your browser|verify you are human|robot challenge|cf-chl|captcha|request blocked|access denied/i;

const bareHost = (url: string) => new URL(url).hostname.replace(/^www\./, "").toLowerCase();
const withoutQuery = (url: string) => url.replace(/[#?].*$/, "").replace(/\/$/, "");
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

function resolve(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Whether a link found on a source is worth suggesting: on the source's own
 * site (www. or not), not one of the never-news paths, and not the listing
 * page itself.
 */
export function isArticleLink(url: string, sourceUrl: string): boolean {
  try {
    const u = new URL(url);
    if (bareHost(url) !== bareHost(sourceUrl)) return false;
    if (NOT_AN_ARTICLE.test(u.pathname + u.search)) return false;
    return withoutQuery(url) !== withoutQuery(sourceUrl) && u.pathname !== "/";
  } catch {
    return false;
  }
}

/** Drops non-articles and duplicates, keeping the first title seen for a link. */
export function keepArticles(items: FoundItem[], sourceUrl: string): FoundItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = withoutQuery(item.url);
    if (!item.title || seen.has(key) || !isArticleLink(item.url, sourceUrl)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Article links on a news listing page. Two patterns cover most
 * WordPress/Shopify-style listings — a heading wrapping a link, or a link
 * wrapping a heading — with plain title-length link text as the fallback.
 */
export function extractListingLinks(html: string, baseUrl: string): FoundItem[] {
  const $ = cheerio.load(html);
  GLOBAL_NOISE_SELECTORS.forEach((sel) => $(sel).remove());

  const root = $(MAIN_SELECTORS.find((sel) => $(sel).length) ?? "body").first();
  // Safe only once root no longer needs it: pagination <nav> inside a listing isn't an article.
  root.find("nav").remove();

  const seen = new Map<string, string>();
  root.find("h1, h2, h3, h4").each((_, el) => {
    const heading = $(el);
    const href = resolve(heading.find("a").first().attr("href"), baseUrl);
    const title = tidy(heading.text());
    if (href && title.length >= 10 && !seen.has(href)) seen.set(href, title);
  });
  root.find("a").each((_, el) => {
    const a = $(el);
    const href = resolve(a.attr("href"), baseUrl);
    if (!href || seen.has(href)) return;
    const heading = a.find("h1, h2, h3, h4").first();
    const title = tidy(heading.length ? heading.text() : a.text());
    if (title.length >= 15 && title.length <= 200 && !GENERIC_LINK_TEXT.test(title)) seen.set(href, title);
  });
  return [...seen].map(([url, title]) => ({ url, title, publishedAt: null }));
}

/** RSS/Atom feeds a page advertises with <link rel="alternate">, comment feeds excluded. */
export function advertisedFeeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const feeds = $('link[type="application/rss+xml"], link[type="application/atom+xml"]')
    .map((_, el) => resolve($(el).attr("href"), baseUrl))
    .get()
    .filter((href): href is string => !!href && !/comments\/feed/i.test(href));
  return [...new Set(feeds)];
}

/** Where the common site builders put a feed when the page doesn't advertise one. */
export function guessedFeeds(listingUrl: string): string[] {
  const { origin } = new URL(listingUrl);
  const listing = withoutQuery(listingUrl);
  return [...new Set([
    `${listing}/feed/`, // WordPress, per section
    `${origin}/feed/`, // WordPress, site-wide
    `${listing}?format=rss`, // Squarespace
    `${listing}.atom`, // Shopify blogs
    `${origin}/blog-feed.xml`, // Wix
    `${origin}/rss.xml`,
    `${origin}/feed.xml`,
    `${origin}/blog/rss.xml`, // HubSpot
  ])];
}

/** Items in an RSS 2.0, RSS 1.0 or Atom feed, or null when the body isn't a feed with items. */
export function parseFeed(xml: string, baseUrl: string): FoundItem[] | null {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return null;
  const $ = cheerio.load(xml, { xml: true });
  const items: FoundItem[] = [];
  $("item, entry").each((_, el) => {
    const node = $(el);
    // Atom: <link rel="alternate" href>; RSS: <link>text</link>
    const atomLink = node.find('link[rel="alternate"]').attr("href") ?? node.find("link[href]").first().attr("href");
    const url = resolve(atomLink ?? node.find("link").first().text(), baseUrl);
    const title = tidy(cheerio.load(node.find("title").first().text()).text());
    const date = node.find("pubDate").first().text() || node.find("published").first().text()
      || node.find("updated").first().text() || node.find("dc\\:date").first().text();
    if (url && title) items.push({ url, title, publishedAt: isoOrNull(date) });
  });
  return items.length ? items : null;
}

/** Posts from the WordPress REST API (`/wp-json/wp/v2/posts`), or null when it isn't that. */
export function parseWpPosts(body: string): FoundItem[] | null {
  if (!body.trimStart().startsWith("[")) return null;
  let posts: unknown;
  try {
    posts = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(posts)) return null;
  const items = posts.flatMap((post) => {
    const p = post as { link?: unknown; title?: { rendered?: unknown }; date_gmt?: unknown; date?: unknown };
    if (typeof p.link !== "string" || typeof p.title?.rendered !== "string") return [];
    // `rendered` is HTML (entities, sometimes tags) — read it as text
    const title = tidy(cheerio.load(p.title.rendered).text());
    const date = typeof p.date_gmt === "string" ? `${p.date_gmt}Z` : typeof p.date === "string" ? p.date : undefined;
    return title ? [{ url: p.link, title, publishedAt: isoOrNull(date) }] : [];
  });
  return items.length ? items : null;
}

/** A sitemap's page URLs (`urls`) or, for a sitemap index, its child sitemaps (`children`). */
export function parseSitemap(xml: string): { urls: { url: string; lastmod: string | null }[]; children: string[] } | null {
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) return null;
  const $ = cheerio.load(xml, { xml: true });
  const children = $("sitemapindex > sitemap > loc").map((_, el) => tidy($(el).text())).get();
  const urls = $("urlset > url").map((_, el) => ({
    url: tidy($(el).find("loc").first().text()),
    lastmod: isoOrNull($(el).find("lastmod").first().text() || undefined),
  })).get().filter((u) => u.url);
  return { urls, children };
}

/**
 * The sitemap pages that belong to the news listing: under its path when it
 * has one ("/news/..."), otherwise anything that looks like a post. A sitemap
 * has no titles, so one is made from the last path segment.
 */
export function sitemapArticles(urls: { url: string; lastmod: string | null }[], listingUrl: string): FoundItem[] {
  const listingPath = new URL(listingUrl).pathname.replace(/\/$/, "");
  return urls.flatMap(({ url, lastmod }) => {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return [];
    }
    const underListing = listingPath.length > 1 && path.startsWith(`${listingPath}/`);
    if (!underListing && !/\/(news|blog|insights?|articles?|press|media|updates|latest|stories|case-stud(y|ies))\//i.test(path)) return [];
    return [{ url, title: titleFromUrl(url), publishedAt: lastmod }];
  });
}

/**
 * A news-page address as typed into the console or imported from the list:
 * http(s) only, scheme added when missing, fragment dropped. `domain` is the
 * bare host, the label the console groups and sorts by.
 */
export function normalizeSourceUrl(raw: string): { url: string; domain: string } | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) return null;
    url.hash = "";
    return { url: url.toString(), domain: url.hostname.replace(/^www\./, "").toLowerCase() };
  } catch {
    return null;
  }
}

/** "https://x.co.uk/news/new-press-brake-installed/" → "New press brake installed". */
export function titleFromUrl(url: string): string {
  const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(segment).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : url;
}

/** Whether a body is a bot-protection interstitial rather than the page. */
export function looksLikeChallenge(body: string): boolean {
  const $ = cheerio.load(body);
  return CHALLENGE.test(`${$("title").text()} ${tidy($("body").text()).slice(0, 400)}`);
}
