import { serviceDb } from "../db/server";
import type { Tables, TablesInsert } from "../db/types";
import { logError } from "../log";
import {
  advertisedFeeds, extractListingLinks, guessedFeeds, keepArticles, looksLikeChallenge,
  parseFeed, parseSitemap, parseWpPosts, sitemapArticles, type FoundItem,
} from "./extract";
import { fetchText } from "./fetch";

/**
 * The story-sources watcher (ChangeTower replacement, migration
 * 20261020000002). Each source is read the cheapest way that works — feed,
 * WordPress API, the listing page's HTML, then the sitemap — worked out once
 * and stored on the source, so a daily check is usually one feed request.
 *
 * It only ever writes `content_sources` and `source_items`. A new item is a
 * suggestion on /console/sources; turning one into a story is a person's click.
 */

export type ReadMethod = "feed" | "wp_api" | "html" | "sitemap";
/** Mirrors the `content_sources.access` check constraint. */
export type Access = "unknown" | "ok" | "blocked" | "not_found" | "unreachable" | "empty";
type Source = Pick<Tables<"content_sources">, "id" | "url" | "method" | "method_url" | "last_ok_at" | "last_item_at" | "failure_count">;
type Db = ReturnType<typeof serviceDb>;

export type Reading = { method: ReadMethod; methodUrl: string; items: FoundItem[] };
export type Unreadable = { access: Exclude<Access, "ok" | "unknown">; error: string };

/** After this many failed reads with the stored method, the next check works the method out again. */
export const REDETECT_AFTER = 3;
/** Each source is checked about once a day (Luiza, 20 Oct 2026); a little under 24h so it doesn't drift later each day. */
export const CHECK_EVERY_MS = 20 * 60 * 60 * 1000;
/** Cap on links recorded per read — a sitemap can list thousands of pages. */
const MAX_ITEMS_PER_READ = 2000;
/** An item dated this long before the source's last good read is old news found late, not new. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

const FEED_ACCEPT = "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.5";

/** Read a source with a known method. Null when the read failed; [] when it worked and found nothing. */
export async function readWith(method: ReadMethod, methodUrl: string, sourceUrl: string): Promise<FoundItem[] | null> {
  if (method === "sitemap") return readSitemap(methodUrl, sourceUrl);
  const res = await fetchText(methodUrl, method === "html" ? undefined : FEED_ACCEPT);
  if (!res.ok) return null;
  const found =
    method === "feed" ? parseFeed(res.body, res.finalUrl)
    : method === "wp_api" ? parseWpPosts(res.body)
    : looksLikeChallenge(res.body) ? null
    : extractListingLinks(res.body, res.finalUrl);
  return found ? keepArticles(found, sourceUrl) : null;
}

async function readSitemap(sitemapUrl: string, sourceUrl: string): Promise<FoundItem[] | null> {
  const res = await fetchText(sitemapUrl, FEED_ACCEPT);
  const parsed = res.ok ? parseSitemap(res.body) : null;
  if (!parsed) return null;
  let urls = parsed.urls;
  if (parsed.children.length) {
    // An index: read the children that look like posts first, at most three.
    const ranked = [...parsed.children.filter((c) => /(post|news|blog|article|insight|press)/i.test(c)), ...parsed.children];
    for (const child of [...new Set(ranked)].slice(0, 3)) {
      const childRes = await fetchText(child, FEED_ACCEPT);
      const childParsed = childRes.ok ? parseSitemap(childRes.body) : null;
      if (childParsed) urls = urls.concat(childParsed.urls);
    }
  }
  return keepArticles(sitemapArticles(urls, sourceUrl), sourceUrl);
}

/**
 * Work out how to read a source, trying the cheapest and cleanest first. A
 * method only counts if it yields at least one article link — a feed that
 * carries nothing but product pages isn't a way to read the news.
 */
export async function discover(sourceUrl: string): Promise<Reading | Unreadable> {
  const origin = new URL(sourceUrl).origin;
  const listing = await fetchText(sourceUrl);
  const home = listing.ok && new URL(listing.finalUrl).pathname === "/" ? listing : await fetchText(`${origin}/`);
  // Neither the page nor the homepage answered at all (timeout, DNS, TLS):
  // every other address on the site would only wait out the same timeout —
  // ~15 of them took a live check 2½ minutes. Give up now; it's retried tomorrow.
  if (listing.status === 0 && home.status === 0) return classifyUnreadable(listing);

  const feeds = [...new Set([
    ...(listing.ok ? advertisedFeeds(listing.body, listing.finalUrl) : []),
    ...(home.ok ? advertisedFeeds(home.body, home.finalUrl) : []),
    ...guessedFeeds(sourceUrl),
  ])];
  for (const feed of feeds) {
    const items = await readWith("feed", feed, sourceUrl);
    if (items?.length) return { method: "feed", methodUrl: feed, items };
  }

  const wpUrl = `${origin}/wp-json/wp/v2/posts?per_page=20&_fields=date_gmt,link,title`;
  const wpItems = await readWith("wp_api", wpUrl, sourceUrl);
  if (wpItems?.length) return { method: "wp_api", methodUrl: wpUrl, items: wpItems };

  if (listing.ok && !looksLikeChallenge(listing.body)) {
    const htmlItems = keepArticles(extractListingLinks(listing.body, listing.finalUrl), sourceUrl);
    if (htmlItems.length) return { method: "html", methodUrl: sourceUrl, items: htmlItems };
  }

  const robots = await fetchText(`${origin}/robots.txt`, "text/plain");
  const fromRobots = robots.ok ? [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  for (const sitemap of [...new Set([...fromRobots, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`])].slice(0, 4)) {
    const items = await readWith("sitemap", sitemap, sourceUrl);
    if (items?.length) return { method: "sitemap", methodUrl: sitemap, items };
  }

  return classifyUnreadable(listing);
}

/** Why nothing worked, from the listing page's own response. */
export function classifyUnreadable(listing: { ok: boolean; status: number; body: string; error?: string }): Unreadable {
  if (listing.status === 0) return { access: "unreachable", error: listing.error ?? "no response" };
  if ([401, 403, 429].includes(listing.status) || looksLikeChallenge(listing.body)) {
    return { access: "blocked", error: listing.status >= 400 ? `HTTP ${listing.status} — the site refuses automated requests` : "the site shows a bot-check page instead of its content" };
  }
  if (listing.status === 404 || listing.status === 410) return { access: "not_found", error: `HTTP ${listing.status} — the news page has moved or gone` };
  if (!listing.ok) return { access: "unreachable", error: `HTTP ${listing.status}` };
  return { access: "empty", error: "no feed, API or sitemap, and no article links found on the page (it may need JavaScript)" };
}

/**
 * Which of a read's items to record, and in what state. The first good read
 * of a source is all baseline — it's what was already there, not news. After
 * that an item is new unless it's dated well before the last good read (old
 * news surfacing late, e.g. a sitemap reshuffle).
 */
export function itemRows(source: Pick<Source, "id" | "last_ok_at">, items: FoundItem[], now: Date): TablesInsert<"source_items">[] {
  const baselineAll = !source.last_ok_at;
  const staleBefore = source.last_ok_at ? Date.parse(source.last_ok_at) - STALE_MS : 0;
  return items.slice(0, MAX_ITEMS_PER_READ).map((item) => ({
    source_id: source.id,
    url: item.url,
    title: item.title.slice(0, 300),
    published_at: item.publishedAt,
    first_seen_at: now.toISOString(),
    state: baselineAll || (item.publishedAt !== null && Date.parse(item.publishedAt) < staleBefore) ? "baseline" : "new",
  }));
}

function newestDate(items: FoundItem[], previous: string | null): string | null {
  const dates = items.map((i) => i.publishedAt).concat(previous).filter((d): d is string => !!d);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

/** Check one source and record what it found. Returns how many new suggestions it made, and whether the source could be read at all. */
export async function checkSource(db: Db, source: Source, now = new Date()): Promise<{ newItems: number; access: Access; read: boolean }> {
  const stamp = now.toISOString();
  let reading: Reading | Unreadable;
  if (source.method && source.method_url && source.failure_count < REDETECT_AFTER) {
    const items = await readWith(source.method as ReadMethod, source.method_url, source.url);
    if (items === null) {
      const { error } = await db.from("content_sources").update({
        last_checked_at: stamp, failure_count: source.failure_count + 1,
        last_error: `couldn't read the ${source.method.replace("_", " ")} at ${source.method_url}`, updated_at: stamp,
      }).eq("id", source.id);
      if (error) throw new Error(`content_sources update: ${error.message}`);
      return { newItems: 0, access: "ok", read: false };
    }
    reading = { method: source.method as ReadMethod, methodUrl: source.method_url, items };
  } else {
    reading = await discover(source.url);
  }

  if ("access" in reading) {
    const { error } = await db.from("content_sources").update({
      method: null, method_url: null, access: reading.access, last_error: reading.error,
      last_checked_at: stamp, failure_count: source.failure_count + 1, updated_at: stamp,
    }).eq("id", source.id);
    if (error) throw new Error(`content_sources update: ${error.message}`);
    return { newItems: 0, access: reading.access, read: false };
  }

  const rows = itemRows(source, reading.items, now);
  let newItems = 0;
  if (rows.length) {
    // A link already on file — from this source or a duplicate listing of the
    // same site — is left exactly as it is.
    const { data, error } = await db.from("source_items")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("state");
    if (error) throw new Error(`source_items insert: ${error.message}`);
    newItems = (data ?? []).filter((row) => row.state === "new").length;
  }
  const { error } = await db.from("content_sources").update({
    method: reading.method, method_url: reading.methodUrl, access: "ok",
    last_checked_at: stamp, last_ok_at: stamp, last_item_at: newestDate(reading.items, source.last_item_at),
    failure_count: 0, last_error: null, updated_at: stamp,
  }).eq("id", source.id);
  if (error) throw new Error(`content_sources update: ${error.message}`);
  return { newItems, access: "ok", read: true };
}

/**
 * The `source_watch` job: check the active sources that are due, least
 * recently checked first, until the time budget runs out. Sources are
 * different sites, so a few run at once; one site is never hit in parallel.
 * Whatever isn't reached is simply still due next run.
 *
 * The budget is a hard stop: a slow site can keep one source busy for a
 * minute or more (every address discovery tries can wait out fetch.ts's 15s
 * timeout), so once the budget and `overrunMs` have passed it stops waiting.
 * A source still being read then is left out of the counts; whatever it
 * hasn't written yet keeps it due. Without this, a click ran 70s against a
 * 45s budget and would have hit the 60s server limit (issue #42).
 *
 * Call it through runSourceCheck (./run.ts), which makes sure only one check
 * runs at a time and keeps the record the console shows.
 */
export async function runSourceWatch({ budgetMs = 45_000, overrunMs = 5_000, concurrency = 6, maxSources = 300, now = () => new Date() } = {}) {
  const db = serviceDb();
  const { data: due, error } = await db.from("content_sources")
    .select("id, url, method, method_url, last_ok_at, last_item_at, failure_count")
    .eq("active", true)
    .or(dueFilter(now()))
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(maxSources);
  if (error) throw new Error(`source_watch: reading sources: ${error.message}`);

  const deadline = Date.now() + budgetMs;
  const queue = [...(due ?? [])];
  let checked = 0, newItems = 0, unreadable = 0, failed = 0;
  const workers = Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length && Date.now() < deadline) {
      const source = queue.shift()!;
      try {
        const result = await checkSource(db, source, now());
        checked++;
        newItems += result.newItems;
        if (!result.read) unreadable++;
      } catch (e) {
        // One bad source must not stop the rest; it stays due and is retried next run.
        failed++;
        logError({ source: "job", area: "job:source_watch", error: e, context: { url: source.url } });
      }
    }
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hardStop = new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now()) + overrunMs); });
  await Promise.race([workers, hardStop]);
  clearTimeout(timer);
  return { due: due?.length ?? 0, checked, newItems, unreadable, failed };
}

/** PostgREST `or` filter for an active source's being due: never checked, or last checked a day ago or more. */
export function dueFilter(now: Date): string {
  const cutoff = new Date(now.getTime() - CHECK_EVERY_MS).toISOString();
  return `last_checked_at.is.null,last_checked_at.lt.${cutoff}`;
}
