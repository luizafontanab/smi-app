import { describe, expect, it } from "vitest";
import { planIndustryBackfill, type BackfillInput } from "../../scripts/lib/industry-backfill";
import { INDUSTRY_ROWS } from "../../scripts/lib/industries";

/**
 * planIndustryBackfill is the whole decision the production backfill makes —
 * the database layer around it only reads and writes. Pinned here: which
 * industry each kind of row gets, and what reaches the report for Jas.
 */

const industries = INDUSTRY_ROWS.map((r, i) => ({ ...r, id: 100 + i }));
const id = (slug: string) => industries.find((i) => i.slug === slug)!.id;

const input = (over: Partial<BackfillInput> = {}): BackfillInput => ({
  industries,
  members: [],
  stories: [],
  videos: [],
  events: [],
  ...over,
});

describe("planIndustryBackfill — members", () => {
  it("links a member to every industry their services touch and picks the specific one as primary", () => {
    const plan = planIndustryBackfill(
      input({ members: [{ id: "m1", slug: "acme", name: "Acme", services: ["welding-joining-fastening", "forging", "assembly"] }] }),
    );
    expect(plan.links.map((l) => l.industry_id).sort()).toEqual(
      [id("welding-joining"), id("machinery-tools-equipment"), id("subcontractor-news")].sort(),
    );
    expect(plan.members).toEqual([{ id: "m1", industry_id: id("welding-joining") }]);
  });

  it("always includes the primary among the member's links", () => {
    const plan = planIndustryBackfill(
      input({
        members: [
          { id: "m1", slug: "a", name: "A", services: ["forging", "assembly", "tool-die"] },
          { id: "m2", slug: "b", name: "B", services: ["software-cad-cam-erp", "automation-robotics"] },
        ],
      }),
    );
    for (const m of plan.members) {
      expect(plan.links).toContainEqual({ member_id: m.id, industry_id: m.industry_id });
    }
  });

  it("leaves a member whose services map nowhere without an industry, and reports them", () => {
    const plan = planIndustryBackfill(
      input({ members: [{ id: "m1", slug: "lawyers", name: "Lawyers Ltd", services: ["recruitment-services"] }] }),
    );
    expect(plan.links).toEqual([]);
    expect(plan.members).toEqual([{ id: "m1", industry_id: null }]);
    expect(plan.report.unresolvedMembers).toEqual([{ slug: "lawyers", name: "Lawyers Ltd", services: ["recruitment-services"] }]);
  });
});

describe("planIndustryBackfill — content", () => {
  const members = [{ id: "m1", slug: "acme", name: "Acme", services: ["welding-joining-fastening"] }];

  it("gives a story the industry of its categories, ahead of its member's", () => {
    const plan = planIndustryBackfill(
      input({ members, stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: ["software-cad-cam-erp"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: id("software-it-services") }]);
  });

  it("falls back to the member's primary when the categories say nothing", () => {
    const plan = planIndustryBackfill(
      input({ members, stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: ["industry-news"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: id("welding-joining") }]);
  });

  it("leaves a member-less Industry News story without one, and reports it", () => {
    const plan = planIndustryBackfill(
      input({ stories: [{ id: "s1", slug: "news", title: "News", member_id: null, categories: ["industry-news"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: null }]);
    expect(plan.report.unresolvedStories).toEqual([{ slug: "news", title: "News", categories: ["industry-news"] }]);
  });

  it("gives videos and events their member's primary, and nothing without a member", () => {
    const plan = planIndustryBackfill(
      input({
        members,
        videos: [{ id: "v1", member_id: "m1" }, { id: "v2", member_id: null }],
        events: [{ id: "e1", member_id: "m1" }, { id: "e2", member_id: null }],
      }),
    );
    expect(plan.videos).toEqual([{ id: "v1", industry_id: id("welding-joining") }, { id: "v2", industry_id: null }]);
    expect(plan.events).toEqual([{ id: "e1", industry_id: id("welding-joining") }, { id: "e2", industry_id: null }]);
  });
});

describe("planIndustryBackfill — report", () => {
  it("lists slugs neither map has seen, once each", () => {
    const plan = planIndustryBackfill(
      input({
        members: [{ id: "m1", slug: "a", name: "A", services: ["new-service", "new-service", "forging"] }],
        stories: [{ id: "s1", slug: "s", title: "S", member_id: null, categories: ["new-topic", "industry-news"] }],
      }),
    );
    expect(plan.report.unknownServices).toEqual(["new-service"]);
    expect(plan.report.unknownCategories).toEqual(["new-topic"]);
  });

  it("names an industry the database lacks instead of silently dropping it", () => {
    const plan = planIndustryBackfill(
      input({
        industries: industries.filter((i) => i.slug !== "welding-joining"),
        members: [{ id: "m1", slug: "a", name: "A", services: ["welding-joining-fastening"] }],
      }),
    );
    expect(plan.report.missingIndustries).toEqual(["Welding & Joining"]);
  });

  it("is deterministic: the same input gives the same plan", () => {
    const i = input({
      members: [{ id: "m1", slug: "a", name: "A", services: ["assembly", "forming", "welding-joining-fastening"] }],
      stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: ["forging", "exhibitions"] }],
    });
    expect(planIndustryBackfill(i)).toEqual(planIndustryBackfill(i));
  });
});
