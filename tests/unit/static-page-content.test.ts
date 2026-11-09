import { describe, expect, it } from "vitest";
import { AUTHORED_STATIC_PAGES } from "../../scripts/lib/static-page-content";
import { collapseSections } from "@/lib/collapse-sections";
import { renderableHtml } from "@/lib/sanitize";

const page = (slug: string) => {
  const p = AUTHORED_STATIC_PAGES.find((x) => x.slug === slug);
  if (!p) throw new Error(`no authored page ${slug}`);
  return p;
};

// Both seeds upsert these rows on slug; a repeated slug is a primary-key
// violation that silently drops every static page (it did, in seed.ts).
it("authors each slug once", () => {
  const slugs = AUTHORED_STATIC_PAGES.map((p) => p.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

describe("FAQ (GAPS A9.6)", () => {
  const faq = page("faq");
  // What /pages/[slug] actually renders for a collapsible page.
  const rendered = collapseSections(renderableHtml(faq.body));

  it("groups questions under News, Members and Events, as the 18 Sep call asked", () => {
    const groups = [...faq.body.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(groups).toEqual(expect.arrayContaining(["News", "Members", "Events"]));
  });

  it("survives sanitisation with every question intact", () => {
    const questions = (faq.body.match(/<h3>/g) ?? []).length;
    expect(questions).toBeGreaterThan(20);
    expect((renderableHtml(faq.body).match(/<h3>/g) ?? []).length).toBe(questions);
  });

  it("renders every group as a card and every question nested inside one", () => {
    const groups = (faq.body.match(/<h2>/g) ?? []).length;
    const questions = (faq.body.match(/<h3>/g) ?? []).length;
    expect((rendered.match(/<details/g) ?? []).length).toBe(groups + questions);
    // nothing sits outside a group: the body opens on a heading, not a preamble
    expect(rendered.startsWith("<details")).toBe(true);
  });

  it("has no answer left as an internal placeholder", () => {
    expect(faq.body).not.toMatch(/SMI TO CONFIRM|TODO/);
  });
});

it("Policies and Membership terms open collapsible, like the FAQ", () => {
  expect(page("policies").collapsible).toBe(true);
  expect(page("membership-terms").collapsible).toBe(true);
});

// #91 (Jas item 24): members ask SMI to cancel, so nothing published may point
// them at a cancel button in the member area.
describe("cancelling goes through SMI", () => {
  it("the membership terms say to cancel by contacting us", () => {
    const terms = page("membership-terms").body;
    expect(terms).toContain("You can cancel at any time by contacting us. Cancelling stops the next payment;");
    expect(terms).not.toContain("from your member area");
  });

  // Decided 9 Nov 2026: no refund is offered when a member cancels, so the
  // pro-rata placeholder goes rather than waiting on SMI.
  it("the membership terms carry no placeholder about pro-rata refunds", () => {
    expect(page("membership-terms").body).not.toMatch(/pro-rata refund/);
  });

  it("the FAQ sends cancelling to SMI and keeps self-service for the rest", () => {
    const faq = page("faq").body;
    expect(faq).toContain("update your details, change your password or view invoices. To cancel, contact us.");
    expect(faq).not.toContain("view invoices, or cancel.");
    expect(faq).not.toContain("or cancel from the same page");
  });
});
