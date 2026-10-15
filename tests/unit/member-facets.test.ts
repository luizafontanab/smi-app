import { describe, expect, it } from "vitest";
import { computeFacets, narrowOptions, type FacetMember } from "@/lib/member-facets";

const m = (industries: string[], services: string[], types: string[]): FacetMember => ({
  industries: new Set(industries),
  services: new Set(services),
  types: new Set(types),
});

// Two equipment suppliers and one service provider, with different services.
const members = [
  m(["laser"], ["laser-cutting", "folding"], ["equipment-supplier"]),
  m(["welding"], ["welding-robots"], ["equipment-supplier", "software"]),
  m(["laser"], ["subcontract-laser"], ["service-provider"]),
];
const none = { industries: [], services: [], membershipTypes: [] };

describe("computeFacets (GAPS A9.1)", () => {
  it("with nothing selected, offers everything any member has", () => {
    const f = computeFacets(members, none);
    expect([...f.services].sort()).toEqual(["folding", "laser-cutting", "subcontract-laser", "welding-robots"]);
    expect([...f.industries].sort()).toEqual(["laser", "welding"]);
  });

  // The reported bug: picking a membership type left the whole services list on offer.
  it("picking a membership type narrows services and industries to members of that type", () => {
    const f = computeFacets(members, { ...none, membershipTypes: ["service-provider"] });
    expect([...f.services]).toEqual(["subcontract-laser"]);
    expect([...f.industries]).toEqual(["laser"]);
  });

  it("does not narrow an axis by its own selection, since within an axis the filter is OR", () => {
    const f = computeFacets(members, { ...none, membershipTypes: ["service-provider"] });
    // every type still offered, so a second one can be ticked to widen the result
    expect([...f.membershipTypes].sort()).toEqual(["equipment-supplier", "service-provider", "software"]);
  });

  it("ANDs across axes, matching the directory query", () => {
    const f = computeFacets(members, { industries: ["laser"], services: [], membershipTypes: ["equipment-supplier"] });
    expect([...f.services].sort()).toEqual(["folding", "laser-cutting"]);
  });

  it("ignores a member with no industry for the industry facet but keeps its services", () => {
    const f = computeFacets([m([], ["folding"], ["software"])], none);
    expect(f.industries.size).toBe(0);
    expect([...f.services]).toEqual(["folding"]);
  });

  // A member is in several industries since migration 20261012000001.
  it("matches a member on any of its industries, and offers all of them", () => {
    const both = m(["welding", "bending"], ["tube-bending"], ["subcontractor"]);
    const f = computeFacets([both], { ...none, industries: ["bending"] });
    expect([...f.services]).toEqual(["tube-bending"]);
    expect([...f.membershipTypes]).toEqual(["subcontractor"]);
    // the industry facet ignores its own selection, so both industries stay on offer
    expect([...f.industries].sort()).toEqual(["bending", "welding"]);
  });

  it("offers nothing when no member matches", () => {
    const f = computeFacets([], { ...none, membershipTypes: ["software"] });
    expect(f.services.size + f.industries.size + f.membershipTypes.size).toBe(0);
  });
});

describe("narrowOptions", () => {
  const options = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];

  it("leaves the list whole when there are no facets", () => {
    expect(narrowOptions(options, null, [])).toEqual(options);
  });

  it("keeps only available options", () => {
    expect(narrowOptions(options, new Set(["b"]), [])).toEqual([{ slug: "b" }]);
  });

  // Hiding a selected option would leave the reader no way to untick it.
  it("always keeps a selected option, even when it now matches nothing", () => {
    expect(narrowOptions(options, new Set(["b"]), ["c"])).toEqual([{ slug: "b" }, { slug: "c" }]);
  });
});
