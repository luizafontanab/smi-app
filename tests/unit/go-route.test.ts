import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/go/[memberId]/route";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * The member contact-link click tracker. It reads through serviceDb, so RLS
 * does not hide an archived member from it the way it does from every public
 * page — the filter has to be in the route (fix list 72).
 */

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

const ctx = (memberId: string) => ({ params: Promise.resolve({ memberId }) });
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
/** A reader's click — a browser UA, since a request without one is treated as a bot (lib/bots). */
const click = (url: string, ua = BROWSER) => new Request(url, { headers: { "user-agent": ua } });
const member = (over: Record<string, unknown> = {}) => ({
  id: "m1", slug: "acme", website: "https://acme.example", phone: "0114 000 0000",
  contact_email: "hi@acme.example", social: null, archived_at: null, ...over,
});

function db(row: unknown) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(row)) })));
}

describe("GET /go/[memberId]", () => {
  it("forwards a live member's website click and records it", async () => {
    db(member());

    await expect(GET(click("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "outbound_click", member_id: "m1" })]);
  });

  it("sends an archived member's click home instead of onward", async () => {
    db(member({ archived_at: "2026-09-23T10:00:00Z" }));

    // Home, not /member/acme: that page 404s for everyone but an admin.
    await expect(GET(click("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("records nothing for an archived member — the link should no longer exist", async () => {
    db(member({ archived_at: "2026-09-23T10:00:00Z" }));

    await expect(GET(click("https://smi.local/go/m1?kind=phone"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });

  // Review 16 Oct: "www.foo.co.uk" as a Location is relative — the reader
  // landed on /go/www.foo.co.uk and from there the homepage.
  it("sends a website stored without a scheme to the site, not to a relative path", async () => {
    db(member({ website: "www.acme.co.uk" }));

    await expect(GET(click("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:https://www.acme.co.uk");
  });

  it("falls back to the member page for a website that can't be a link", async () => {
    db(member({ website: "javascript:alert(1)" }));

    await expect(GET(click("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:/member/acme");
  });

  it.each([
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["ClaudeBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"],
    ["AhrefsBot", "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)"],
    ["curl", "curl/8.4.0"],
    ["no user-agent at all", ""],
  ])("redirects %s without counting a click or touching the consent counter", async (_label, ua) => {
    db(member());

    await expect(GET(click("https://smi.local/go/m1?kind=website", ua), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");
    expect(record).not.toHaveBeenCalled();
    expect(requestContext).not.toHaveBeenCalled();
  });

  it("still counts a phone whose model name ends in 'bot' (Cubot)", async () => {
    db(member());

    const cubot = "Mozilla/5.0 (Linux; Android 11; CUBOT P50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    await expect(GET(click("https://smi.local/go/m1?kind=website", cubot), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");
    expect(record).toHaveBeenCalledOnce();
  });

  it("still sends an unknown member home", async () => {
    db(null);

    await expect(GET(click("https://smi.local/go/nope?kind=website"), ctx("nope"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });
});
