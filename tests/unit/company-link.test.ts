import { describe, expect, it } from "vitest";
import { companyLinksFor, markCompanyLink, memberWebsiteHref, withCompanyLines } from "@/lib/company-link";

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
// featured member — their name linking to their website — and the author's own
// closing line is kept, never doubled.
describe("companyLinksFor", () => {
  it("one line per member with a website, primary first", () => {
    const links = companyLinksFor(
      [
        { id: "m2", name: "AMOB UK", website: "https://amob.example" },
        { id: "m1", name: "BLM Group", website: "https://www.blmgroup.com" },
        { id: "m3", name: "No Site Ltd", website: null },
      ],
      "m1",
    );
    expect(links.map((l) => [l.name, l.href, l.primary])).toEqual([
      ["BLM Group", "/go/m1?kind=website", true],
      ["AMOB UK", "/go/m2?kind=website", false],
    ]);
  });
});

describe("withCompanyLines", () => {
  const blm = { name: "BLM Group <UK>", href: "/go/m1?kind=website", website: "https://www.blmgroup.com", primary: true };
  const amob = { name: "AMOB UK", href: "/go/m2?kind=website", website: "https://amob.example/en", primary: false };
  const line = (href: string, name: string) => `<p data-company-link=""><a href="${href}" target="_blank" rel="noopener">${name}</a></p>`;

  it("adds a line per member when the story doesn't close with one, escaped", () => {
    expect(withCompanyLines("<p>Body.</p>", [blm, amob])).toBe(
      `<p>Body.</p>${line("/go/m1?kind=website", "BLM Group &lt;UK&gt;")}${line("/go/m2?kind=website", "AMOB UK")}`,
    );
  });

  it("an author's line to a member's site covers that member; the others still get theirs", () => {
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://amob.example/">AMOB</a></p>`, [blm, amob]);
    expect(out.match(/data-company-link/g)).toHaveLength(2);
    expect(out).toContain("/go/m1?kind=website");
    expect(out).not.toContain("/go/m2?kind=website");
  });

  it("an author's line that matches nobody is taken as the primary member's", () => {
    const out = withCompanyLines(`<p>Body.</p><p><a href="https://old-blm-site.example/">BLM GROUP</a></p>`, [blm, amob]);
    expect(out).not.toContain("/go/m1?kind=website");
    expect(out).toContain("/go/m2?kind=website");
  });

  it("adds nothing without members", () => {
    expect(withCompanyLines("<p>Body.</p>", [])).toBe("<p>Body.</p>");
  });
});

describe("memberWebsiteHref", () => {
  it("goes through the tracked click-through", () => {
    expect(memberWebsiteHref("m1")).toBe("/go/m1?kind=website");
  });
});
