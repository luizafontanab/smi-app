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

  it("swaps Resend's unsubscribe tag for a real link when asked — a test send isn't a broadcast", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 9, subject: "s", intro: null, web_slug: null })),
      newsletter_items: () => queryBuilder(dbOk([])),
      newsletter_ads: () => queryBuilder(dbOk([])),
    });

    const rendered = await renderIssueHtml("iss1", { unsubscribeUrl: "https://smi.test/unsubscribe" });

    expect(rendered!.html).toContain('href="https://smi.test/unsubscribe"');
    expect(rendered!.text).toContain("Unsubscribe: https://smi.test/unsubscribe");
    expect(rendered!.html + rendered!.text).not.toContain("RESEND_UNSUBSCRIBE_URL");
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

  describe("the live-issue layout (gap review area 5)", () => {
    const story = (n: number) => ({
      position: n,
      story: { slug: `story-${n}`, title: `Story ${n}`, excerpt: `Summary ${n}`, cover_path: `cover-${n}.jpg` },
      video: null,
    });
    const banner = (id: string, after_item: number | null = null, name = `Advert ${id}`) => ({
      position: 0, after_item, advert: { id, name, format: "newsletter_banner", desktop_path: null, mobile_path: `${id}.jpg` },
    });
    function issue(fields: Record<string, unknown>, items: unknown[], ads: unknown[]) {
      db({
        newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 50, subject: "November", intro: null, preview_text: null, web_slug: null, ...fields })),
        newsletter_items: () => queryBuilder(dbOk(items)),
        newsletter_ads: () => queryBuilder(dbOk(ads)),
      });
    }
    const order = (html: string, needles: string[]) => needles.map((n) => html.indexOf(n));

    it("draws the first item as the full-width lead and the rest two to a row under the heading", async () => {
      issue({}, [1, 2, 3, 4].map(story), []);
      const { html } = (await renderIssueHtml("iss1"))!;

      expect(html).toContain('width="544" alt="Story 1"');
      expect(html).toContain('width="264" alt="Story 2"');
      expect(html.match(/class="smi-col"/g)).toHaveLength(2); // one two-up row (2+3); story 4 sits alone
      expect(html).toContain('width="544" alt="Story 4"');
      const [lead, heading, second] = order(html, ["Story 1", "Sheeting Hot News", "Story 2"]);
      expect(lead).toBeLessThan(heading);
      expect(heading).toBeLessThan(second);
    });

    it("gives every card image its title as alt text — the live issues have none", async () => {
      issue({}, [story(1)], []);
      expect((await renderIssueHtml("iss1"))!.html).not.toContain('alt=""');
    });

    it("places adverts between the rows, labelled Sponsored, with newsletter click tracking", async () => {
      issue({}, [1, 2, 3, 4, 5, 6, 7].map(story), [banner("a1"), banner("a2")]);
      const { html } = (await renderIssueHtml("iss1"))!;

      const [s3, a1, s4, s7, a2] = order(html, ["Story 3", "a1.jpg", "Story 4", "Story 7", "a2.jpg"]);
      expect(s3).toBeLessThan(a1);
      expect(a1).toBeLessThan(s4);
      expect(s7).toBeLessThan(a2);
      expect(html).toContain("/visit/a1?src=newsletter");
      expect(html).toContain(">Sponsored<");
      expect(html).not.toContain("Advertisement");
    });

    it("honours an advert's own place", async () => {
      issue({}, [1, 2, 3, 4, 5].map(story), [banner("a1", 1)]);
      const { html } = (await renderIssueHtml("iss1"))!;
      const [s1, a1, s2] = order(html, ["Story 1", "a1.jpg", "Story 2"]);
      expect(s1).toBeLessThan(a1);
      expect(a1).toBeLessThan(s2);
    });

    it("escapes an advert's name into its alt text", async () => {
      issue({}, [story(1)], [banner("a1", null, 'Acme "Laser" <Ltd>')]);
      const { html } = (await renderIssueHtml("iss1"))!;
      expect(html).toContain('alt="Acme &quot;Laser&quot; &lt;Ltd&gt;"');
    });

    it("puts the association logo in the masthead, not between the stories", async () => {
      issue({}, [1, 2, 3, 4].map(story), [
        { position: 0, after_item: null, advert: { id: "logo1", name: "Greenfield", format: "association_logo", desktop_path: "logo1.png", mobile_path: null } },
      ]);
      const { html } = (await renderIssueHtml("iss1"))!;

      expect(html).toContain("In association with");
      expect(html).toContain("/visit/logo1?src=newsletter");
      expect(html.indexOf("logo1.png")).toBeLessThan(html.indexOf("Story 1"));
      expect(html).not.toContain(">Sponsored<");
      expect(html).toContain("/logo-stacked.png");
    });

    it("has no sponsor block without an association logo", async () => {
      issue({}, [story(1)], []);
      expect((await renderIssueHtml("iss1"))!.html).not.toContain("In association with");
    });

    it("renders the preview text as a hidden preheader, escaped", async () => {
      issue({ preview_text: "Laser <news> & more" }, [story(1)], []);
      const { html } = (await renderIssueHtml("iss1"))!;
      expect(html).toContain('<div style="display:none;');
      expect(html).toContain("Laser &lt;news&gt; &amp; more");
      expect(html.indexOf("Laser &lt;news&gt;")).toBeLessThan(html.indexOf("Story 1"));
    });

    it("leaves no preheader when the issue has no preview text", async () => {
      issue({ preview_text: "  " }, [story(1)], []);
      expect((await renderIssueHtml("iss1"))!.html).not.toContain("display:none");
    });

    it("draws a sponsored story as its own card, marked Sponsored and tracked through /visit", async () => {
      issue({}, [1, 2, 3, 4].map(story), [
        { position: 0, after_item: null, advert: { id: "sp1", name: "Bystronic", format: "sponsored_story", desktop_path: "sp1.jpg", mobile_path: "sp1.jpg", headline: "Bending <faster>", body: "Eighty words at most." } },
      ]);
      const { html } = (await renderIssueHtml("iss1"))!;

      expect(html).toContain("Bending &lt;faster&gt;");
      expect(html).toContain('alt="Bending &lt;faster&gt;"');
      expect(html).toContain("Eighty words at most.");
      expect(html).toContain("/visit/sp1?src=newsletter");
      expect(html).toContain(">Sponsored<");
      // placed like a banner: after item 3
      const [s3, sp, s4] = order(html, ["Story 3", "sp1.jpg", "Story 4"]);
      expect(s3).toBeLessThan(sp);
      expect(sp).toBeLessThan(s4);
    });

    it("adds the events diary and the supplier directory after the stories, in both versions", async () => {
      db({
        newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 50, subject: "November", intro: null, preview_text: null, web_slug: null, scheduled_at: "2026-11-03T09:00:00Z", sent_at: null })),
        newsletter_items: () => queryBuilder(dbOk([story(1)])),
        newsletter_ads: () => queryBuilder(dbOk([])),
        events: () => queryBuilder(dbOk([{ slug: "euroblech", title: "EuroBLECH & co", starts_on: "2026-11-10", ends_on: "2026-11-13", location: "Hanover" }])),
        newsletter_directory: () => queryBuilder(dbOk([{ member: { slug: "amada", name: "Amada", logo_path: null, status: "active", archived_at: null } }])),
      });
      const { html, text } = (await renderIssueHtml("iss1"))!;

      expect(html).toContain("Events diary");
      expect(html).toContain("10–13 November");
      expect(html).toContain("EuroBLECH &amp; co");
      expect(html).toContain("/event/euroblech");
      expect(html).toContain("Supplier directory");
      expect(html).toContain("/member/amada");
      expect(html.indexOf("Story 1")).toBeLessThan(html.indexOf("Events diary"));
      expect(html.indexOf("Events diary")).toBeLessThan(html.indexOf("Supplier directory"));
      expect(text).toContain("- 10–13 November: EuroBLECH & co");
      expect(text).toContain("- Amada: ");
    });

    it("leaves the diary and directory out when there is nothing to list", async () => {
      issue({}, [story(1)], []);
      const { html } = (await renderIssueHtml("iss1"))!;
      expect(html).not.toContain("Events diary");
      expect(html).not.toContain("Supplier directory");
    });

    it("tags every story and advert link with the issue, and each advert with its slot", async () => {
      issue({}, [1, 2, 3, 4, 5].map(story), [
        banner("a1"), banner("a2"),
        { position: 0, after_item: null, advert: { id: "logo1", name: "Greenfield", format: "association_logo", desktop_path: "logo1.png", mobile_path: null } },
      ]);
      const { html, text } = (await renderIssueHtml("iss1"))!;

      expect(html).toContain("/news/story-1?src=newsletter&amp;issue=iss1");
      expect(text).toContain("/news/story-1?src=newsletter&issue=iss1");
      expect(html).toContain("/visit/a1?src=newsletter&amp;issue=iss1&amp;slot=banner-1");
      expect(html).toContain("/visit/a2?src=newsletter&amp;issue=iss1&amp;slot=banner-2");
      expect(html).toContain("/visit/logo1?src=newsletter&amp;issue=iss1&amp;slot=masthead");
    });

    it("lists items in the composer's order in the text version, videos mixed in", async () => {
      issue({}, [
        { position: 0, story: null, video: { slug: "demo", title: "Demo video", thumbnail_path: null } },
        story(1),
      ], []);
      const { text } = (await renderIssueHtml("iss1"))!;
      expect(text.indexOf("Demo video")).toBeLessThan(text.indexOf("Story 1"));
      expect(text).toContain("/video/demo");
    });
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
      // Anything not answered below fails the test rather than reaching Resend.
      .mockImplementation(async (input) => { throw new Error(`unexpected fetch: ${String(input)}`); })
      .mockResolvedValueOnce(new Response("{}", { status: 200 })) // sub@ created
      .mockResolvedValueOnce(new Response("{}", { status: 409 })) // unsub@ already exists
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "list", has_more: false, data: [] }), { status: 200 })); // the segment listing the prune reads

    const result = await getNewsletterSender().syncContacts();

    expect(result).toEqual({ pushed: 2, failed: 0 });
    const bodies = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(init?.body as string));
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
