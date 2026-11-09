import { describe, expect, it } from "vitest";
import { closingLinksFromForm, companyLinksFor, markCompanyLink, readClosingLinks, withCompanyLines } from "@/lib/company-link";

// The closing company line (Luiza 15 Oct, from Jas 13/10 item 2's screenshot):
// a last paragraph holding only a link is marked so it renders in caps, larger,
// in orange. Anything else is left exactly as it was.
describe("markCompanyLink", () => {
  it("marks a last paragraph that is only a link", () => {
    expect(markCompanyLink(`<p>Body.</p><p><a href="https://www.sigmanest.com/">SigmaNEST</a></p>`))
      .toBe(`<p>Body.</p><p data-company-link=""><a href="https://www.sigmanest.com/">SigmaNEST</a></p>`);
  });

  it("allows the link to be wrapped in bold/italic/underline, and trailing whitespace", () => {
    const html = `<p>x</p><p><strong><a href="https://www.icee.co.uk/" rel="noopener nofollow">ICEE Managed Services Ltd</a></strong></p>\n`;
    expect(markCompanyLink(html)).toContain(`<p data-company-link=""><strong><a`);
  });

  it.each([
    ["text alongside the link", `<p>Body.</p><p>Don't miss it, <a href="https://x.example">click here</a></p>`],
    ["a link that isn't in the last paragraph", `<p><a href="https://x.example">Acme</a></p><p>More copy.</p>`],
    ["two links in the last paragraph", `<p><a href="https://a.example">A</a> <a href="https://b.example">B</a></p>`],
    ["no link at all", `<p>Just text.</p>`],
  ])("leaves %s alone", (_label, html) => {
    expect(markCompanyLink(html)).toBe(html);
  });
});

// Luiza 15 Oct (Jas 13/10 item 2): every member story ends with a line per
// featured member, and the author's own closing line is kept, never doubled.
// Luiza 7 Nov (Jas 13/10: "if they are member than i prefer to link to their
// membership page"): a member's line goes to their SMI page, and companies Jas
// picks from Bigin follow, linking to their websites.
describe("companyLinksFor", () => {
  const members = [
    { id: "m2", name: "AMOB UK", slug: "amob-uk", website: "https://amob.example" },
    { id: "m1", name: "BLM Group", slug: "blm-group", website: "https://www.blmgroup.com" },
    { id: "m3", name: "No Site Ltd", slug: "no-site", website: null },
  ];

  it("one line per member to their member page, primary first, website or not", () => {
    expect(companyLinksFor(members, "m1").map((l) => [l.name, l.href, l.primary, l.external])).toEqual([
      ["BLM Group", "/member/blm-group", true, false],
      ["AMOB UK", "/member/amob-uk", false, false],
      ["No Site Ltd", "/member/no-site", false, false],
    ]);
  });

  it("picked companies follow the members, in order, linking to their website", () => {
    const links = companyLinksFor(members.slice(0, 1), "m2", [
      { bigin_id: "b1", name: "Trumpf", url: "https://www.trumpf.com" },
      { bigin_id: null, name: "Acme Fab", url: "https://acme.example" },
    ]);
    expect(links.map((l) => [l.name, l.href, l.external])).toEqual([
      ["AMOB UK", "/member/amob-uk", false],
      ["Trumpf", "https://www.trumpf.com", true],
      ["Acme Fab", "https://acme.example", true],
    ]);
  });

  it("a picked company that is a featured member, or picked twice, shows once", () => {
    const links = companyLinksFor(members, "m1", [
      { bigin_id: "b1", name: "BLM GROUP LTD", url: "https://elsewhere.example" }, // same name
      { bigin_id: "b2", name: "Amob (UK)", url: "https://amob.example/en" }, // same site
      { bigin_id: "b3", name: "Trumpf", url: "https://www.trumpf.com" },
      { bigin_id: "b4", name: "Trumpf Ltd", url: "https://trumpf.co.uk" },
    ]);
    expect(links.map((l) => l.name)).toEqual(["BLM Group", "AMOB UK", "No Site Ltd", "Trumpf"]);
  });
});

describe("readClosingLinks", () => {
  it("keeps well-formed entries, made links; skips the rest", () => {
    expect(readClosingLinks([
      { bigin_id: "b1", name: " Trumpf ", url: "www.trumpf.com" },
      { bigin_id: "", name: "Acme", url: "https://acme.example/x" },
      { bigin_id: "b2", name: "", url: "https://x.example" },
      { bigin_id: "b3", name: "Bad", url: "javascript:alert(1)" },
      "junk",
      null,
    ])).toEqual([
      { bigin_id: "b1", name: "Trumpf", url: "https://www.trumpf.com" },
      { bigin_id: null, name: "Acme", url: "https://acme.example/x" },
    ]);
  });

  it.each([null, undefined, {}, "[]"])("anything but an array is no links (%s)", (raw) => {
    expect(readClosingLinks(raw)).toEqual([]);
  });
});

describe("closingLinksFromForm", () => {
  const form = (rows: [string, string, string][], sent = true) => {
    const f = new FormData();
    if (sent) f.set("closing_links_sent", "1");
    for (const [id, name, url] of rows) {
      f.append("closing_link_bigin_id", id);
      f.append("closing_link_name", name);
      f.append("closing_link_url", url);
    }
    return f;
  };

  it("leaves the column alone when the form had no picker", () => {
    expect(closingLinksFromForm(form([], false))).toEqual({ value: undefined });
  });

  it("an empty picker clears them", () => {
    expect(closingLinksFromForm(form([]))).toEqual({ value: [] });
  });

  it("reads each row, a hand-typed one with no Bigin id, and skips a blank row", () => {
    expect(closingLinksFromForm(form([["b1", "Trumpf", "trumpf.com"], ["", "Acme", "https://acme.example"], ["", " ", ""]]))).toEqual({
      value: [
        { bigin_id: "b1", name: "Trumpf", url: "https://trumpf.com" },
        { bigin_id: null, name: "Acme", url: "https://acme.example" },
      ],
    });
  });

  it("refuses a company without a usable website, naming it", () => {
    const res = closingLinksFromForm(form([["b1", "Trumpf", ""]]));
    expect(res).toEqual({ error: expect.stringContaining('"Trumpf" needs a website address') });
  });

  it("refuses more than ten", () => {
    const rows = Array.from({ length: 11 }, (_, i): [string, string, string] => [`b${i}`, `Co ${i}`, `https://co${i}.example`]);
    expect(closingLinksFromForm(form(rows))).toEqual({ error: expect.stringContaining("at most 10") });
  });
});

describe("withCompanyLines", () => {
  const blm = { name: "BLM Group <UK>", href: "/member/blm-group", website: "https://www.blmgroup.com", primary: true, external: false };
  const amob = { name: "AMOB UK", href: "/member/amob-uk", website: "https://amob.example/en", primary: false, external: false };
  // a member line stays on SMI, so no new tab
  const line = (href: string, name: string) => `<p data-company-link=""><a href="${href}" aria-label="${name}">${name}</a></p>`;

  it("adds a line per member when the story doesn't close with one, escaped", () => {
    expect(withCompanyLines("<p>Body.</p>", [blm, amob])).toBe(
      `<p>Body.</p>${line("/member/blm-group", "BLM Group &lt;UK&gt;")}${line("/member/amob-uk", "AMOB UK")}`,
    );
  });

  it("names the link in its own case for screen readers, escaped for the attribute", () => {
    const out = withCompanyLines("<p>Body.</p>", [{ ...blm, name: `Smith & "Sons"` }]);
    expect(out).toContain(`aria-label="Smith &amp; &quot;Sons&quot;"`);
  });

  it("an author's line to a member's site covers that member; the others still get theirs", () => {
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://amob.example/">AMOB</a></p>`, [blm, amob]);
    expect(out.match(/data-company-link/g)).toHaveLength(2);
    expect(out).toContain("/member/blm-group");
    expect(out).not.toContain("/member/amob-uk");
  });

  it("an author's line naming a member covers them even when its link has moved", () => {
    // imported stories: the lead company's name, pointing at an old homepage
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://old-blm-site.example/">BLM GROUP (UK) LTD.</a></p>`, [blm, amob]);
    expect(out).toContain(`<p data-company-link=""><a href="https://old-blm-site.example/">BLM GROUP (UK) LTD.</a></p>`);
    expect(out).not.toContain("/member/blm-group");
    expect(out).toContain("/member/amob-uk");
  });

  it("matches a name through entities, '&'/'and' and wrapping tags", () => {
    const apt = { name: "AP and T Group", href: "/member/apt", website: "https://aptgroup.example", primary: true, external: false };
    const out = withCompanyLines(`<p>Body.</p><p><strong><a href="https://elsewhere.example/">AP&amp;T Group</a></strong></p>`, [apt]);
    expect(out).toContain(`<p data-company-link=""><strong>`);
    expect(out).not.toContain("/member/apt");
  });

  // Review 16 Oct: "Watch the video" → YouTube was taken as the primary
  // member's line, so their backlink vanished and the video link was styled
  // as the orange company line.
  it("a closing link that is nobody's stays ordinary copy, and every member keeps their line", () => {
    const video = `<p>Body.</p><p><a href="https://www.youtube.com/watch?v=abc">Watch the video</a></p>`;
    const out = withCompanyLines(video, [blm, amob]);
    expect(out.startsWith(video)).toBe(true);
    expect(out).toBe(`${video}${line("/member/blm-group", "BLM Group &lt;UK&gt;")}${line("/member/amob-uk", "AMOB UK")}`);
  });

  it("doesn't match on a merely similar name", () => {
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://x.example/">AMOB UK Lasers</a></p>`, [amob]);
    expect(out).not.toContain(`<p data-company-link=""><a href="https://x.example/">`);
    expect(out).toContain("/member/amob-uk");
  });

  it("recognises a member whose website was stored without a scheme", () => {
    const bare = { ...amob, website: "www.amob.example" };
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://amob.example/contact">Get in touch</a></p>`, [bare]);
    expect(out).toContain(`<p data-company-link=""><a href="https://amob.example/contact">`);
    expect(out).not.toContain("/member/amob-uk");
  });

  it("leaves a story without featured members exactly as written", () => {
    const html = `<p>Body.</p><p><a href="https://www.sigmanest.com/">SigmaNEST</a></p>`;
    expect(withCompanyLines(html, [])).toBe(html);
  });

  it("a picked company's line opens its website in a new tab", () => {
    const acme = { name: "Acme", href: "https://acme.example/", website: "https://acme.example/", primary: false, external: true };
    expect(withCompanyLines("<p>Body.</p>", [acme])).toBe(
      `<p>Body.</p><p data-company-link=""><a href="https://acme.example/" target="_blank" rel="noopener" aria-label="Acme">Acme</a></p>`,
    );
  });

  it("adds nothing without members", () => {
    expect(withCompanyLines("<p>Body.</p>", [])).toBe("<p>Body.</p>");
  });
});
