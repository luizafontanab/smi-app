import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, resolveClickPath } from "@/app/visit/[id]/route";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { record, requestContext } = vi.hoisted(() => ({
  record: vi.fn(() => {}),
  requestContext: vi.fn(async () => ({ session_hash: "h", referrer: null, region: null, company: null, consented: true })),
}));
vi.mock("@/lib/analytics", () => ({ record, requestContext }));

afterEach(() => {
  resetDbServerMocks();
  record.mockClear();
  requestContext.mockClear();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** A reader's click — a browser UA, since a request without one is treated as a bot (lib/bots). */
const click = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { "user-agent": BROWSER, ...headers } });

describe("GET /visit/[id]", () => {
  it("sends a reader with an unknown advert id straight home", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));

    await expect(GET(click("https://smi.local/visit/bogus"), ctx("bogus"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });

  it("records the click and sends the reader to the advert's own link when it has one", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "https://acme.example", member: { id: "m1", slug: "acme" } })),
    })));

    const req = click("https://smi.local/visit/ad1", { referer: "https://smi.local/news" });
    await expect(GET(req, ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");

    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_click", advert_id: "ad1", member_id: "m1", path: "/news" })]);
  });

  it("sends a memberless house advert home and records a null member_id", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: null, member: null })),
    })));

    await expect(GET(click("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:/");

    // The click is still worth counting even with nowhere better to send them.
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_click", advert_id: "ad1", member_id: null })]);
  });

  it("falls back to the advertiser's member page with no explicit link", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: null, member: { id: "m1", slug: "acme" } })),
    })));

    await expect(GET(click("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:/member/acme");
  });

  it("sends a scheme-less stored link to the advertiser's site, not to a relative /visit/ path", async () => {
    // Saved before the console validated link_url, or by the member's own
    // advert form, which stores it as typed.
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "www.acme.co.uk", member: { id: "m1", slug: "acme" } })),
    })));

    await expect(GET(click("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow(/^NEXT_REDIRECT:https:\/\/www\.acme\.co\.uk$/);
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_click", advert_id: "ad1", member_id: "m1" })]);
  });

  it("never redirects to a non-web link — the member page instead, and the click still counts", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "javascript:alert(document.cookie)", member: { id: "m1", slug: "acme" } })),
    })));

    await expect(GET(click("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow(/^NEXT_REDIRECT:\/member\/acme$/);
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_click", advert_id: "ad1", member_id: "m1" })]);
  });

  it("sends a junk link home when the advertiser's page is withdrawn too", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "n/a", member: { id: "m1", slug: "acme", status: "lapsed", archived_at: null } })),
    })));

    await expect(GET(click("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow(/^NEXT_REDIRECT:\/$/);
  });
});

describe("GET /visit/[id] from a crawler", () => {
  it("still redirects, but counts no ad click", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "https://acme.example", member: { id: "m1", slug: "acme" } })),
    })));

    const req = new Request("https://smi.local/visit/ad1", { headers: { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" } });
    await expect(GET(req, ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");
    expect(record).not.toHaveBeenCalled();
    expect(requestContext).not.toHaveBeenCalled();
  });
});

describe("resolveClickPath", () => {
  it("prefers a confirmed newsletter marker over any referer", () => {
    const req = new Request("https://smi.local/visit/ad1?src=newsletter", { headers: { referer: "https://smi.local/news" } });
    expect(resolveClickPath(req)).toBe("newsletter");
  });

  it("reads the pathname from a same-origin referer", () => {
    const req = new Request("https://smi.local/visit/ad1", { headers: { referer: "https://smi.local/news/some-story" } });
    expect(resolveClickPath(req)).toBe("/news/some-story");
  });

  it("falls back to \"unknown\" for a cross-origin referer (e.g. a webmail proxy)", () => {
    const req = new Request("https://smi.local/visit/ad1", { headers: { referer: "https://mail.example.com/inbox" } });
    expect(resolveClickPath(req)).toBe("unknown");
  });

  it("falls back to \"unknown\" with no referer at all", () => {
    expect(resolveClickPath(new Request("https://smi.local/visit/ad1"))).toBe("unknown");
  });

  it("falls back to \"unknown\" for a malformed referer", () => {
    const req = new Request("https://smi.local/visit/ad1", { headers: { referer: "not-a-url" } });
    expect(resolveClickPath(req)).toBe("unknown");
  });
});
