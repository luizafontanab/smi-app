import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campaignFor, issueFromLink, newsletterLinkParams, newsletterParams, slotFromLink, summariseIssueClicks, utmSlug, withUtm,
} from "@/lib/newsletter-tracking";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => resetDbServerMocks());

const ISSUE = "11111111-1111-4111-8111-111111111111";

describe("link building", () => {
  it("tags a link with the source, the issue and, for adverts, the slot", () => {
    expect(newsletterParams(ISSUE)).toBe(`src=newsletter&issue=${ISSUE}`);
    expect(newsletterParams(ISSUE, "banner-2")).toBe(`src=newsletter&issue=${ISSUE}&slot=banner-2`);
  });

  it("names the campaign after the month the issue goes out", () => {
    expect(campaignFor("2026-11-03T09:00:00Z")).toBe("smi-2026-11");
    expect(campaignFor(null, new Date("2026-10-21T10:00:00Z"))).toBe("smi-2026-10");
  });

  it("slugs advertiser names and slots for utm_content, never empty", () => {
    expect(utmSlug("Kerf Developments Ltd")).toBe("kerf-developments-ltd");
    expect(utmSlug("  !!  ")).toBe("unknown");
    expect(slotFromLink("Banner-2")).toBe("banner-2");
    expect(slotFromLink(null)).toBe("advert");
    expect(slotFromLink('"><script>')).toBe("script");
  });
});

describe("withUtm", () => {
  it("adds the SOP's four tags to the advertiser's own site", () => {
    const url = new URL(withUtm("https://kerf.example/cutting?ref=1", "smi-2026-11", "kerf-banner-1"));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: "1", utm_source: "newsletter", utm_medium: "email", utm_campaign: "smi-2026-11", utm_content: "kerf-banner-1",
    });
  });

  it("keeps a tag the advertiser already set", () => {
    const url = new URL(withUtm("https://kerf.example/?utm_campaign=their-own", "smi-2026-11", "kerf-banner-1"));
    expect(url.searchParams.get("utm_campaign")).toBe("their-own");
    expect(url.searchParams.get("utm_source")).toBe("newsletter");
  });

  it("leaves an on-site fallback alone", () => {
    expect(withUtm("/member/kerf", "smi-2026-11", "kerf-banner-1")).toBe("/member/kerf");
    expect(withUtm("mailto:sales@kerf.example", "smi-2026-11", "kerf-banner-1")).toBe("mailto:sales@kerf.example");
  });
});

describe("issueFromLink", () => {
  it("ignores an ordinary visit, an old link with no issue, and a bad id, without a query", async () => {
    const from = fromByTable({});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    expect(await issueFromLink({ src: null, issue: ISSUE })).toBeNull();
    expect(await issueFromLink({ src: "newsletter", issue: null })).toBeNull();
    expect(await issueFromLink({ src: "newsletter", issue: "not-a-uuid" })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a real issue with its campaign, and nothing for a made-up one", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ newsletter_issues: () => queryBuilder(dbOk({ id: ISSUE, scheduled_at: "2026-11-03T09:00:00Z", sent_at: null })) }),
    })));
    expect(await issueFromLink({ src: "newsletter", issue: ISSUE })).toEqual({ id: ISSUE, campaign: "smi-2026-11" });

    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ newsletter_issues: () => queryBuilder(dbOk(null)) }) })));
    expect(await issueFromLink({ src: "newsletter", issue: ISSUE })).toBeNull();
  });

  it("reads single params only from Next's searchParams", () => {
    expect(newsletterLinkParams({ src: "newsletter", issue: [ISSUE, ISSUE] })).toEqual({ src: "newsletter", issue: null });
  });
});

describe("summariseIssueClicks", () => {
  const items = [
    { story: { id: "s1", title: "Lead story" }, video: null },
    { story: { id: "s2", title: "Second story" }, video: null },
    { story: null, video: { slug: "demo", title: "Demo video" } },
  ];
  const ads = [{ advert_id: "a1", name: "Kerf banner" }, { advert_id: "a2", name: "Prima banner" }];

  it("ranks stories and videos together and lists every advert, zeros included", () => {
    const report = summariseIssueClicks([
      { kind: "story_view", story_id: "s2", advert_id: null, path: null, clicks: 9, visitors: 7 },
      { kind: "page_view", story_id: null, advert_id: null, path: "/video/demo", clicks: 4, visitors: 4 },
      { kind: "story_view", story_id: "s1", advert_id: null, path: null, clicks: 6, visitors: 5 },
      { kind: "ad_click", story_id: null, advert_id: "a1", path: null, clicks: 3, visitors: 2 },
    ], items, ads);

    expect(report.top.map((r) => [r.title, r.clicks])).toEqual([["Second story", 9], ["Lead story", 6], ["Demo video", 4]]);
    expect(report.adverts).toEqual([
      { name: "Kerf banner", clicks: 3, visitors: 2 },
      { name: "Prima banner", clicks: 0, visitors: 0 },
    ]);
  });

  it("keeps only the top five, and still counts things since removed from the issue", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ kind: "story_view", story_id: `gone${i}`, advert_id: null, path: null, clicks: i + 1, visitors: 1 }));
    rows.push({ kind: "ad_click", story_id: null, advert_id: "gone-ad", path: null, clicks: 2, visitors: 2 } as never);

    const report = summariseIssueClicks(rows, items, ads);

    expect(report.top).toHaveLength(5);
    expect(report.top[0]).toEqual({ title: "A story no longer in this issue", clicks: 7, visitors: 1 });
    expect(report.adverts).toContainEqual({ name: "An advert no longer in this issue", clicks: 2, visitors: 2 });
  });
});
