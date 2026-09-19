import { afterEach, describe, expect, it, vi } from "vitest";
import { getLeadGenSource, isProspectAction } from "@/lib/adapters/leadgen";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("getLeadGenSource — mock source", () => {
  it("returns the same prospects for the same query, every time", async () => {
    // Determinism is load-bearing: the visual suite photographs both lead-gen
    // pages, so a shuffling list would diff on every run.
    const source = getLeadGenSource();

    const first = await source.search({});
    const second = await source.search({});

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("filters by company type using membership_types slugs", async () => {
    const results = await getLeadGenSource().search({ companyType: "software" });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.companyType === "software")).toBe(true);
  });

  it("excludes prospects beyond the radius", async () => {
    const results = await getLeadGenSource().search({ radiusMiles: 15 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => (p.distanceMiles ?? 0) <= 15)).toBe(true);
  });

  it("returns an empty list rather than throwing when nothing matches", async () => {
    expect(await getLeadGenSource().search({ companyType: "software", radiusMiles: 1 })).toEqual([]);
  });

  it("gives a member a stable window, and different members different windows", async () => {
    const source = getLeadGenSource();

    const mine = await source.search({ memberId: "member-1", limit: 5 });
    const mineAgain = await source.search({ memberId: "member-1", limit: 5 });
    const theirs = await source.search({ memberId: "member-9", limit: 5 });

    expect(mine).toEqual(mineAgain);
    expect(mine).toHaveLength(5);
    // The rotation must survive the limit — sorting after it would hand every
    // member the same nearest-5.
    expect(mine.map((p) => p.ref)).not.toEqual(theirs.map((p) => p.ref));
  });

  it("honours the limit", async () => {
    expect(await getLeadGenSource().search({ limit: 3 })).toHaveLength(3);
  });

  it("uses example.com addresses so sample data can't be contacted by mistake", async () => {
    const results = await getLeadGenSource().search({});

    expect(results.every((p) => p.email?.endsWith(".example.com"))).toBe(true);
  });

  it("keys prospects by LinkedIn URL, the way Prosp identifies a lead", async () => {
    const results = await getLeadGenSource().search({ limit: 1 });

    expect(results[0].ref).toMatch(/^https:\/\/www\.linkedin\.com\/company\//);
  });

  it("writes a member mark scoped to that member", async () => {
    const builder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    await getLeadGenSource().mark("https://www.linkedin.com/company/acme", "follow_up", { memberId: "member-1" });

    expect(builder.upsert).toHaveBeenCalledWith(
      { prospect_ref: "https://www.linkedin.com/company/acme", action: "follow_up", member_id: "member-1" },
      expect.objectContaining({ ignoreDuplicates: true }),
    );
  });

  it("writes an admin mark with a null member, against the admin-scoped constraint", async () => {
    const builder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    await getLeadGenSource().mark("https://www.linkedin.com/company/acme", "call", { memberId: null });

    expect(builder.upsert).toHaveBeenCalledWith(
      { prospect_ref: "https://www.linkedin.com/company/acme", action: "call", member_id: null },
      expect.objectContaining({ onConflict: "prospect_ref,action" }),
    );
  });
});

describe("isProspectAction", () => {
  it("accepts the four real actions and rejects anything else", () => {
    for (const action of ["call", "email", "sequence", "follow_up"]) expect(isProspectAction(action)).toBe(true);
    for (const junk of ["delete", "", null, undefined, 7, "FOLLOW_UP"]) expect(isProspectAction(junk)).toBe(false);
  });
});
