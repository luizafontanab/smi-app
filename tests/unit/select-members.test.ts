import { describe, expect, it } from "vitest";
import { PER_INDUSTRY, REQUIRED_MEMBER_SLUGS, selectMembers } from "../../scripts/lib/select-members";
import { INDUSTRIES } from "../../scripts/lib/industries";

type Row = { slug: string; status?: string; logo_path?: string | null; hero_path?: string | null; industry?: string | null };

const industryOf = (r: Row) => r.industry ?? null;
const rows = (n: number, f: (i: number) => Partial<Row> = () => ({})): Row[] =>
  Array.from({ length: n }, (_, i) => ({ slug: `m${i}`, status: "active", ...f(i) }));

describe("selectMembers", () => {
  it("returns everything when the set is already under the limit", () => {
    const all = rows(5);
    expect(selectMembers(all, industryOf, 40)).toEqual(all);
  });

  it("keeps required members even when they'd never make the cut on merit", () => {
    // The featured machine's member: last in the list, no artwork, no industry.
    const all = [...rows(60, () => ({ logo_path: "l", industry: "Welding" })), { slug: REQUIRED_MEMBER_SLUGS[0], status: "active" }];
    const picked = selectMembers(all, industryOf, 10);
    expect(picked.map((r) => r.slug)).toContain(REQUIRED_MEMBER_SLUGS[0]);
  });

  it("gives every represented industry at least PER_INDUSTRY members", () => {
    // 10 per industry, so the limit alone would otherwise let one dominate.
    const all = INDUSTRIES.flatMap((industry) =>
      Array.from({ length: 10 }, (_, i) => ({ slug: `${industry}-${i}`, status: "active", industry })),
    );
    const picked = selectMembers(all, industryOf, 40);
    expect(picked).toHaveLength(40);
    for (const industry of INDUSTRIES) {
      const count = picked.filter((r) => r.industry === industry).length;
      expect(count, `${industry} should not be starved`).toBeGreaterThanOrEqual(PER_INDUSTRY);
    }
  });

  it("prefers members with artwork so the directory has something to render", () => {
    const all = [
      ...rows(30, (i) => ({ slug: `bare${i}`, industry: "Welding" })),
      ...rows(5, (i) => ({ slug: `dressed${i}`, logo_path: "l", hero_path: "h", industry: "Welding" })),
    ];
    const picked = selectMembers(all, industryOf, 10).map((r) => r.slug);
    for (let i = 0; i < 5; i++) expect(picked).toContain(`dressed${i}`);
  });

  it("never exceeds the limit, and preserves the export's order", () => {
    const all = rows(100, (i) => ({ industry: INDUSTRIES[i % INDUSTRIES.length], logo_path: i % 3 ? "l" : null }));
    const picked = selectMembers(all, industryOf, 40);
    expect(picked).toHaveLength(40);
    const order = picked.map((r) => all.indexOf(r));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("still fills the quota when no member has an industry", () => {
    const picked = selectMembers(rows(100, () => ({ industry: null })), industryOf, 40);
    expect(picked).toHaveLength(40);
  });
});
