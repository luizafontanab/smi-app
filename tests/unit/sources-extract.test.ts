import { describe, expect, it } from "vitest";
import {
  advertisedFeeds, extractListingLinks, guessedFeeds, isArticleLink, keepArticles, looksLikeChallenge,
  normalizeSourceUrl, parseFeed, parseSitemap, parseWpPosts, sitemapArticles, titleFromUrl,
} from "@/lib/sources/extract";

const SOURCE = "https://www.example-fab.co.uk/news/";

describe("extractListingLinks", () => {
  it("finds heading-wrapped and link-wrapped article titles inside <main>, ignoring nav and site chrome", () => {
    const html = `<html><body>
      <header><a href="/about-us/">About our long-established company</a></header>
      <main>
        <nav><a href="/news/page/2/">Older posts in the archive listing</a></nav>
        <article><h2><a href="/news/new-fibre-laser/">New 12kW fibre laser installed</a></h2></article>
        <a href="/news/apprentice-award/"><h3>Apprentice of the year award</h3></a>
        <a href="/news/iso-renewed/">ISO 9001 certification renewed again</a>
        <a href="/news/x/">Read more</a>
      </main></body></html>`;
    const urls = extractListingLinks(html, SOURCE).map((l) => l.url);
    expect(urls).toEqual([
      "https://www.example-fab.co.uk/news/new-fibre-laser/",
      "https://www.example-fab.co.uk/news/apprentice-award/",
      "https://www.example-fab.co.uk/news/iso-renewed/",
    ]);
  });
});

describe("isArticleLink / keepArticles", () => {
  it("keeps same-site posts, www or not, and drops the vacancy the coverage test flagged", () => {
    expect(isArticleLink("https://example-fab.co.uk/news/new-laser/", SOURCE)).toBe(true);
    expect(isArticleLink("https://www.example-fab.co.uk/project-coordinator-vacancy/", SOURCE)).toBe(true); // path words alone aren't enough…
    expect(isArticleLink("https://www.example-fab.co.uk/careers/project-coordinator/", SOURCE)).toBe(false); // …a careers path is
    expect(isArticleLink("https://www.example-fab.co.uk/jobs/welder/", SOURCE)).toBe(false);
  });

  it("drops other sites, the listing itself, the homepage, tags, pagination and files", () => {
    for (const url of [
      "https://elsewhere.com/news/story/",
      "https://www.example-fab.co.uk/news/",
      "https://www.example-fab.co.uk/news?utm=x",
      "https://www.example-fab.co.uk/",
      "https://www.example-fab.co.uk/tag/lasers/",
      "https://www.example-fab.co.uk/news/page/3/",
      "https://www.example-fab.co.uk/brochure.pdf",
      "https://www.example-fab.co.uk/products/press-brake/",
    ]) expect(isArticleLink(url, SOURCE), url).toBe(false);
  });

  it("de-duplicates on the address without its query and drops untitled items", () => {
    const kept = keepArticles([
      { url: "https://www.example-fab.co.uk/news/a/", title: "First", publishedAt: null },
      { url: "https://www.example-fab.co.uk/news/a?ref=feed", title: "Duplicate", publishedAt: null },
      { url: "https://www.example-fab.co.uk/news/b/", title: "", publishedAt: null },
    ], SOURCE);
    expect(kept.map((k) => k.title)).toEqual(["First"]);
  });
});

describe("feeds", () => {
  it("parses RSS 2.0 items with CDATA titles, entities and dates", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Fab</title>
      <item><title><![CDATA[Press brake &#8211; new install]]></title><link>https://www.example-fab.co.uk/news/press-brake/</link>
        <pubDate>Tue, 14 Oct 2026 09:00:00 +0000</pubDate></item>
      <item><title>No date here</title><link>https://www.example-fab.co.uk/news/undated/</link></item>
    </channel></rss>`;
    expect(parseFeed(xml, SOURCE)).toEqual([
      { url: "https://www.example-fab.co.uk/news/press-brake/", title: "Press brake – new install", publishedAt: "2026-10-14T09:00:00.000Z" },
      { url: "https://www.example-fab.co.uk/news/undated/", title: "No date here", publishedAt: null },
    ]);
  });

  it("parses Atom entries via their alternate link", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
      <entry><title>Atom post</title><link rel="alternate" href="/blogs/news/atom-post"/><updated>2026-09-01T10:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, "https://shop.example.com/blogs/news")).toEqual([
      { url: "https://shop.example.com/blogs/news/atom-post", title: "Atom post", publishedAt: "2026-09-01T10:00:00.000Z" },
    ]);
  });

  it("returns null for HTML, and for a feed with no items", () => {
    expect(parseFeed("<html><body>not a feed</body></html>", SOURCE)).toBeNull();
    expect(parseFeed("<rss><channel><title>Empty</title></channel></rss>", SOURCE)).toBeNull();
  });

  it("finds advertised feeds but not the comments feed", () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="/feed/">
      <link rel="alternate" type="application/rss+xml" href="/comments/feed/"></head>`;
    expect(advertisedFeeds(html, SOURCE)).toEqual(["https://www.example-fab.co.uk/feed/"]);
  });

  it("guesses the usual WordPress, Squarespace, Shopify, Wix and HubSpot locations", () => {
    expect(guessedFeeds(SOURCE)).toEqual(expect.arrayContaining([
      "https://www.example-fab.co.uk/news/feed/",
      "https://www.example-fab.co.uk/feed/",
      "https://www.example-fab.co.uk/news?format=rss",
      "https://www.example-fab.co.uk/news.atom",
      "https://www.example-fab.co.uk/blog-feed.xml",
      "https://www.example-fab.co.uk/blog/rss.xml",
    ]));
  });
});

describe("parseWpPosts", () => {
  it("reads link, rendered title (as text) and the GMT date", () => {
    const body = JSON.stringify([{ link: "https://example-fab.co.uk/news/wp-post/", title: { rendered: "Laser &amp; press <em>update</em>" }, date_gmt: "2026-10-01T08:30:00" }]);
    expect(parseWpPosts(body)).toEqual([{ url: "https://example-fab.co.uk/news/wp-post/", title: "Laser & press update", publishedAt: "2026-10-01T08:30:00.000Z" }]);
  });

  it("returns null for anything that isn't a JSON array of posts", () => {
    expect(parseWpPosts("<html>")).toBeNull();
    expect(parseWpPosts("[]")).toBeNull();
    expect(parseWpPosts('{"code":"rest_no_route"}')).toBeNull();
  });
});

describe("sitemaps", () => {
  it("reads an index's children and a urlset's pages with lastmod", () => {
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://x.co.uk/post-sitemap.xml</loc></sitemap></sitemapindex>`))
      .toEqual({ urls: [], children: ["https://x.co.uk/post-sitemap.xml"] });
    expect(parseSitemap(`<urlset><url><loc>https://x.co.uk/news/a/</loc><lastmod>2026-10-02</lastmod></url></urlset>`))
      .toEqual({ urls: [{ url: "https://x.co.uk/news/a/", lastmod: "2026-10-02T00:00:00.000Z" }], children: [] });
    expect(parseSitemap("<html></html>")).toBeNull();
  });

  it("keeps pages under the listing path, or news-like paths, with a title made from the slug", () => {
    const items = sitemapArticles([
      { url: "https://x.co.uk/latest/new-press-brake-installed/", lastmod: null },
      { url: "https://x.co.uk/blog/another-post/", lastmod: null },
      { url: "https://x.co.uk/services/laser-cutting/", lastmod: null },
    ], "https://x.co.uk/latest/");
    expect(items.map((i) => i.title)).toEqual(["New press brake installed", "Another post"]);
  });

  it("titleFromUrl strips extensions and separators", () => {
    expect(titleFromUrl("https://x.co.uk/news/big_contract-win.html")).toBe("Big contract win");
  });
});

describe("looksLikeChallenge", () => {
  it("spots the bot-check pages the coverage test met", () => {
    expect(looksLikeChallenge("<title>Just a moment...</title><body>Checking your browser</body>")).toBe(true);
    expect(looksLikeChallenge("<title>Robot Challenge Screen</title>")).toBe(true);
    expect(looksLikeChallenge("<title>Latest news | Example Fab</title><body>Our news</body>")).toBe(false);
  });
});

describe("normalizeSourceUrl", () => {
  it("adds a scheme, drops the fragment and keys the domain without www", () => {
    expect(normalizeSourceUrl("example-fab.co.uk/news#latest")).toEqual({ url: "https://example-fab.co.uk/news", domain: "example-fab.co.uk" });
    expect(normalizeSourceUrl("https://WWW.Example-Fab.co.uk/news/")).toEqual({ url: "https://www.example-fab.co.uk/news/", domain: "example-fab.co.uk" });
  });

  it("refuses non-addresses and non-web schemes", () => {
    expect(normalizeSourceUrl("")).toBeNull();
    expect(normalizeSourceUrl("not a url")).toBeNull();
    expect(normalizeSourceUrl("ftp://example.com/news")).toBeNull();
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
  });
});
