import { afterEach, describe, expect, it, vi } from "vitest";
import { getNewsletterSender, newsletterIsLive, renderIssueHtml } from "@/lib/adapters/newsletter";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable(map, () => queryBuilder(dbOk(null))) })));
}

describe("renderIssueHtml", () => {
  it("returns null for an issue that doesn't exist", async () => {
    db({ newsletter_issues: () => queryBuilder(dbOk(null)) });
    expect(await renderIssueHtml("missing")).toBeNull();
  });

  it("escapes story titles into the html, and lists them plainly in the text version", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 4, subject: "S & T", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([{ position: 1, story: { slug: "acme-news", title: "Acme <Ltd>", excerpt: null, cover_path: null } }])),
      newsletter_ads: () => queryBuilder(dbOk([])),
    });

    const rendered = await renderIssueHtml("iss1");

    expect(rendered!.subject).toBe("S & T");
    expect(rendered!.html).toContain("Acme &lt;Ltd&gt;");
    expect(rendered!.html).not.toContain("Acme <Ltd>");
    expect(rendered!.text).toContain("- Acme <Ltd>"); // plain text is not HTML-escaped
    expect(rendered!.text).toContain("/news/acme-news");
  });

  it("keeps Resend's unsubscribe placeholder intact through our own substitution", async () => {
    // Our {{token}} substitution deliberately never matches the triple-brace
    // form. A naive /\{\{(\w+)\}\}/ eats the INNER two braces of {{{X}}} and
    // leaves a stray brace around a dead link — a PECR problem, not a cosmetic
    // one, so this is asserted rather than assumed.
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 9, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
    });

    const rendered = await renderIssueHtml("iss1");

    expect(rendered!.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(rendered!.text).toContain("Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}");
  });

  it("renders through the editable wrapper, so the console can reword the chrome", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 9, subject: "Autumn issue", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
      email_templates: () =>
        queryBuilder(dbOk([{ kind: "_newsletter_shell", body_html: "<html><body><h1>{{subject}}</h1>{{items}}<a href=\"{{unsubscribe_url}}\">Out</a></body></html>" }])),
    });

    const rendered = await renderIssueHtml("iss1");

    expect(rendered!.html).toContain("<h1>Autumn issue</h1>");
    // Still carries a live unsubscribe link, whatever the wrapper says.
    expect(rendered!.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
  });

  it("skips a newsletter_items row whose story has been deleted", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([{ position: 1, story: null }])),
      newsletter_ads: () => queryBuilder(dbOk([])),
    });

    const rendered = await renderIssueHtml("iss1");
    expect(rendered!.text).not.toContain("- ");
  });

  it("prefers the mobile advert creative, falling back to desktop, and skips a slot with neither", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([
        { position: 1, advert: { name: "Acme", desktop_path: "d.jpg", mobile_path: "m.jpg", link_url: null } },
        { position: 2, advert: { name: "NoImage", desktop_path: null, mobile_path: null, link_url: null } },
        { position: 3, advert: null },
      ])),
    });

    const rendered = await renderIssueHtml("iss1");

    expect(rendered!.html).toContain("m.jpg");
    expect(rendered!.html).not.toContain("NoImage");
    // marks the click as newsletter-sourced (A5.10) — real per-event attribution,
    // not the referrer-based guess used for on-site clicks
    expect(rendered!.html).toContain("?src=newsletter");
  });

  it("includes the read-online link only when the issue has a web_slug", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: "aug-2026" })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
    });

    expect((await renderIssueHtml("iss1"))!.html).toContain("/newsletters/aug-2026");
  });
});

describe("getNewsletterSender / newsletterIsLive", () => {
  it("falls back to the logging stub with no Resend key", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(newsletterIsLive()).toBe(false);
  });

  it("warns and falls back to the stub when the key is set but the segment id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "re_123");
    vi.stubEnv("RESEND_SEGMENT_ID", "");
    db({ contacts: () => queryBuilder(dbOk([])) });

    await getNewsletterSender().sendIssue("iss1");

    expect(warnSpy).toHaveBeenCalled();
    expect(newsletterIsLive()).toBe(false);
  });

  it("is live once both RESEND_API_KEY and RESEND_SEGMENT_ID are set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_123");
    vi.stubEnv("RESEND_SEGMENT_ID", "seg_1");
    expect(newsletterIsLive()).toBe(true);
  });
});

describe("LoggingNewsletterStub", () => {
  it("reports success with the subscribed count, without contacting a provider", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    db({ contacts: () => queryBuilder(dbOk([{ email: "a@example.com" }, { email: "b@example.com" }])) });

    const result = await getNewsletterSender().sendIssue("iss1");

    expect(result).toEqual({ ok: true, recipients: 2 });
    expect(logSpy).toHaveBeenCalled();
  });

  it("syncContacts is a no-op", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await getNewsletterSender().syncContacts()).toEqual({ pushed: 0, failed: 0 });
  });
});

describe("ResendNewsletterSender", () => {
  function liveEnv() {
    vi.stubEnv("RESEND_API_KEY", "re_123");
    vi.stubEnv("RESEND_SEGMENT_ID", "seg_1");
  }

  it("sendIssue fails cleanly when the issue no longer exists", async () => {
    liveEnv();
    db({ newsletter_issues: () => queryBuilder(dbOk(null)) });

    expect(await getNewsletterSender().sendIssue("missing")).toEqual({ ok: false, error: "Issue not found." });
  });

  it("sendIssue refuses to broadcast to an empty list", async () => {
    liveEnv();
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
      contacts: () => queryBuilder(dbOk([])),
    });

    const result = await getNewsletterSender().sendIssue("iss1");
    expect(result).toEqual({ ok: false, error: "No subscribed contacts — nothing to send." });
  });

  it("sendIssue posts the broadcast with the idempotency key and reports success", async () => {
    liveEnv();
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
      contacts: () => queryBuilder(dbOk([{ email: "a@example.com" }])),
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await getNewsletterSender().sendIssue("iss1", "job-42");

    expect(result).toEqual({ ok: true, recipients: 1 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/broadcasts");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("job-42");
  });

  it("sendIssue reports the provider's rejection", async () => {
    liveEnv();
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 1, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
      contacts: () => queryBuilder(dbOk([{ email: "a@example.com" }])),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("domain not verified", { status: 403 }));

    const result = await getNewsletterSender().sendIssue("iss1");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("403") });
  });

  it("syncContacts pushes subscribed as active and unsubscribed as opted-out, counting a 409 as pushed", async () => {
    liveEnv();
    // subscribedContacts() and unsubscribedContacts() both query "contacts",
    // in that order — route by call order rather than by filter.
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(() =>
        call++ === 0 ? dbOk([{ email: "sub@example.com", name: "Sub" }]) : dbOk([{ email: "unsub@example.com" }]),
      ),
    })));
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 })) // sub@ created
      .mockResolvedValueOnce(new Response("{}", { status: 409 })); // unsub@ already exists

    const result = await getNewsletterSender().syncContacts();

    expect(result).toEqual({ pushed: 2, failed: 0 });
    const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(bodies[0]).toMatchObject({ email: "sub@example.com", unsubscribed: false });
    expect(bodies[1]).toMatchObject({ email: "unsub@example.com", unsubscribed: true });
  });

  it("syncContacts throws a rate-limit-shaped error on a 429, rather than counting it as a failed contact", async () => {
    liveEnv();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([{ email: "a@example.com", name: "A" }])),
    })));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", {
      status: 429, headers: { "retry-after": "3" },
    }));

    await expect(getNewsletterSender().syncContacts()).rejects.toMatchObject({ name: "EmailSendError", status: 429, retryAfterMs: 3000 });
  });
});
