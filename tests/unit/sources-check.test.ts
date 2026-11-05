import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSource, classifyUnreadable, dueFilter, itemRows, runSourceWatch } from "@/lib/sources/check";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

// The network is the one thing these tests never touch: fetchText is replaced
// by a URL → response table per test.
const { fetchText } = vi.hoisted(() => ({ fetchText: vi.fn() }));
vi.mock("@/lib/sources/fetch", () => ({ fetchText }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

type Res = { ok: boolean; status: number; body: string; finalUrl: string; error?: string };
const page = (url: string, body: string, status = 200): Res => ({ ok: status < 400, status, body, finalUrl: url });
function serve(routes: Record<string, Res>) {
  fetchText.mockImplementation(async (url: string) => routes[url] ?? { ok: false, status: 404, body: "", finalUrl: url });
}

const SOURCE_URL = "https://example-fab.co.uk/news/";
const FEED = "https://example-fab.co.uk/feed/";
const rss = (...items: [string, string, string?][]) =>
  `<rss><channel>${items.map(([title, link, date]) => `<item><title>${title}</title><link>${link}</link>${date ? `<pubDate>${date}</pubDate>` : ""}</item>`).join("")}</channel></rss>`;

const NOW = new Date("2026-10-20T10:00:00Z");
const source = (over: Record<string, unknown> = {}) => ({
  id: "src-1", url: SOURCE_URL, method: null, method_url: null, last_ok_at: null, last_item_at: null, failure_count: 0, ...over,
}) as Parameters<typeof checkSource>[1];

afterEach(() => {
  resetDbServerMocks();
  fetchText.mockReset();
  logError.mockReset();
});

describe("itemRows", () => {
  const items = [
    { url: "https://example-fab.co.uk/news/fresh/", title: "Fresh", publishedAt: "2026-10-19T00:00:00.000Z" },
    { url: "https://example-fab.co.uk/news/old/", title: "Old", publishedAt: "2026-06-01T00:00:00.000Z" },
    { url: "https://example-fab.co.uk/news/undated/", title: "Undated", publishedAt: null },
  ];

  it("records everything as baseline on a source's first good read — what was already there isn't news", () => {
    expect(itemRows({ id: "s", last_ok_at: null }, items, NOW).map((r) => r.state)).toEqual(["baseline", "baseline", "baseline"]);
  });

  it("after that, new unless dated well before the last good read", () => {
    const rows = itemRows({ id: "s", last_ok_at: "2026-10-19T09:00:00Z" }, items, NOW);
    expect(rows.map((r) => [r.title, r.state])).toEqual([["Fresh", "new"], ["Old", "baseline"], ["Undated", "new"]]);
  });
});

describe("classifyUnreadable", () => {
  it("names why a source can't be read", () => {
    expect(classifyUnreadable({ ok: false, status: 0, body: "", error: "ENOTFOUND" })).toEqual({ access: "unreachable", error: "ENOTFOUND" });
    expect(classifyUnreadable({ ok: false, status: 403, body: "" }).access).toBe("blocked");
    expect(classifyUnreadable({ ok: true, status: 200, body: "<title>Just a moment...</title>" }).access).toBe("blocked");
    expect(classifyUnreadable({ ok: false, status: 404, body: "" }).access).toBe("not_found");
    expect(classifyUnreadable({ ok: false, status: 500, body: "" }).access).toBe("unreachable");
    expect(classifyUnreadable({ ok: true, status: 200, body: "<main>Nothing</main>" }).access).toBe("empty");
  });
});

describe("checkSource", () => {
  function tables(upserted: { state: string }[] = []) {
    const sources = queryBuilder(dbOk(null));
    const items = queryBuilder(dbOk(upserted));
    return { sources, items, db: asDb(mockDb({ from: fromByTable({ content_sources: () => sources, source_items: () => items }) })) };
  }

  it("discovers an advertised feed, records it on the source, and stores its items as the baseline", async () => {
    serve({
      [SOURCE_URL]: page(SOURCE_URL, `<head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><main></main>`),
      "https://example-fab.co.uk/": page("https://example-fab.co.uk/", "<main></main>"),
      [FEED]: page(FEED, rss(["New laser", "https://example-fab.co.uk/news/new-laser/", "Mon, 19 Oct 2026 08:00:00 GMT"])),
    });
    const t = tables([{ state: "baseline" }]);

    const result = await checkSource(t.db, source(), NOW);

    expect(result).toEqual({ newItems: 0, access: "ok", read: true });
    const [rows, opts] = vi.mocked(t.items.upsert as (...a: unknown[]) => unknown).mock.calls[0] as [Record<string, unknown>[], unknown];
    expect(rows).toEqual([expect.objectContaining({ source_id: "src-1", url: "https://example-fab.co.uk/news/new-laser/", state: "baseline" })]);
    expect(opts).toEqual({ onConflict: "url", ignoreDuplicates: true });
    expect(vi.mocked(t.sources.update as (...a: unknown[]) => unknown).mock.calls[0][0]).toEqual(expect.objectContaining({
      method: "feed", method_url: FEED, access: "ok", failure_count: 0, last_error: null,
      last_ok_at: NOW.toISOString(), last_item_at: "2026-10-19T08:00:00.000Z",
    }));
  });

  it("reads a known method directly and counts only the rows that were actually new", async () => {
    serve({ [FEED]: page(FEED, rss(["A", "https://example-fab.co.uk/news/a/"], ["B", "https://example-fab.co.uk/news/b/"])) });
    // the upsert ignores links already on file, so only genuinely inserted rows come back
    const t = tables([{ state: "new" }]);

    const result = await checkSource(t.db, source({ method: "feed", method_url: FEED, last_ok_at: "2026-10-19T09:00:00Z" }), NOW);

    expect(result.newItems).toBe(1);
    expect(fetchText).toHaveBeenCalledTimes(1); // no rediscovery
  });

  it("counts a failed read against the stored method instead of rediscovering straight away", async () => {
    serve({});
    const t = tables();

    const result = await checkSource(t.db, source({ method: "feed", method_url: FEED, failure_count: 1, last_ok_at: "2026-10-19T09:00:00Z" }), NOW);

    // Still "ok" (one bad read isn't a verdict on the site), but it wasn't read this time.
    expect(result).toEqual({ newItems: 0, access: "ok", read: false });
    expect(vi.mocked(t.sources.update as (...a: unknown[]) => unknown).mock.calls[0][0]).toEqual(expect.objectContaining({ failure_count: 2 }));
    expect(t.items.upsert).not.toHaveBeenCalled();
  });

  it("rediscovers after repeated failures, and records a bot-protected site as blocked", async () => {
    const challenge = page(SOURCE_URL, "<title>Robot Challenge Screen</title>", 202);
    fetchText.mockImplementation(async (url: string) =>
      url === SOURCE_URL || url === "https://example-fab.co.uk/" ? challenge : { ok: false, status: 403, body: "", finalUrl: url });
    const t = tables();

    const result = await checkSource(t.db, source({ method: "feed", method_url: FEED, failure_count: 3 }), NOW);

    expect(result).toEqual({ newItems: 0, access: "blocked", read: false });
    expect(vi.mocked(t.sources.update as (...a: unknown[]) => unknown).mock.calls[0][0]).toEqual(expect.objectContaining({
      access: "blocked", method: null, failure_count: 4,
    }));
  });

  it("gives up after two requests when the site doesn't answer at all, instead of waiting out every timeout", async () => {
    fetchText.mockImplementation(async (url: string) => ({ ok: false, status: 0, body: "", finalUrl: url, error: "timed out" }));
    const t = tables();

    const result = await checkSource(t.db, source(), NOW);

    expect(result.access).toBe("unreachable");
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it("falls back to the news page's HTML when there is no feed or API", async () => {
    serve({
      [SOURCE_URL]: page(SOURCE_URL, `<main><h2><a href="/news/contract-win/">Big contract win for the press shop</a></h2></main>`),
      "https://example-fab.co.uk/": page("https://example-fab.co.uk/", "<main></main>"),
    });
    const t = tables([]);

    await checkSource(t.db, source(), NOW);

    expect(vi.mocked(t.sources.update as (...a: unknown[]) => unknown).mock.calls[0][0]).toEqual(expect.objectContaining({ method: "html", method_url: SOURCE_URL }));
  });
});

describe("runSourceWatch", () => {
  it("keeps going past a source whose write fails, logging it, and reports the totals", async () => {
    serve({ [FEED]: page(FEED, rss(["A", "https://example-fab.co.uk/news/a/"])) });
    const due = [
      { id: "bad", url: SOURCE_URL, method: "feed", method_url: FEED, last_ok_at: null, last_item_at: null, failure_count: 0 },
      { id: "good", url: SOURCE_URL, method: "feed", method_url: FEED, last_ok_at: null, last_item_at: null, failure_count: 0 },
    ];
    // content_sources: first the due-list read, then one update per source — the first update fails
    let sourceCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "source_items") return queryBuilder(dbOk([{ state: "baseline" }]));
      if (table !== "content_sources") throw new Error(`unexpected table ${table}`);
      const call = sourceCalls++;
      return queryBuilder(call === 0 ? dbOk(due) : call === 1 ? dbError("boom") : dbOk(null));
    });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    const result = await runSourceWatch({ concurrency: 1, now: () => NOW });

    expect(result).toEqual({ due: 2, checked: 1, newItems: 0, unreadable: 0, failed: 1 });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "job:source_watch", context: { url: SOURCE_URL } }));
  });

  it("counts a source it couldn't read as checked and unreadable, not as failed", async () => {
    const GONE = "https://example-fab.co.uk/gone-feed/";
    serve({ [FEED]: page(FEED, rss(["A", "https://example-fab.co.uk/news/a/"])) });
    const due = [
      { id: "gone", url: SOURCE_URL, method: "feed", method_url: GONE, last_ok_at: null, last_item_at: null, failure_count: 0 },
      { id: "good", url: SOURCE_URL, method: "feed", method_url: FEED, last_ok_at: null, last_item_at: null, failure_count: 0 },
    ];
    let sourceCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "source_items") return queryBuilder(dbOk([{ state: "new" }]));
      if (table !== "content_sources") throw new Error(`unexpected table ${table}`);
      return queryBuilder(sourceCalls++ === 0 ? dbOk(due) : dbOk(null));
    });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    const result = await runSourceWatch({ concurrency: 1, now: () => NOW });

    expect(result).toEqual({ due: 2, checked: 2, newItems: 1, unreadable: 1, failed: 0 });
    expect(logError).not.toHaveBeenCalled();
  });
  it("stops waiting once the budget is spent, even with a site still answering", async () => {
    // never answers: without the hard stop this test would hang until vitest's timeout
    fetchText.mockImplementation(() => new Promise(() => {}));
    const due = [{ id: "slow", url: SOURCE_URL, method: "feed", method_url: FEED, last_ok_at: null, last_item_at: null, failure_count: 0 }];
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => queryBuilder(dbOk(due)) }) })));

    const started = Date.now();
    const result = await runSourceWatch({ budgetMs: 20, overrunMs: 20, now: () => NOW });

    expect(Date.now() - started).toBeLessThan(1000);
    // still being read, so neither checked nor failed — and it stays due
    expect(result).toEqual({ due: 1, checked: 0, newItems: 0, unreadable: 0, failed: 0 });
  });
});

describe("dueFilter", () => {
  it("is due when never checked, or last checked a day (20h) ago or more", () => {
    expect(dueFilter(NOW)).toBe("last_checked_at.is.null,last_checked_at.lt.2026-10-19T14:00:00.000Z");
  });
});
