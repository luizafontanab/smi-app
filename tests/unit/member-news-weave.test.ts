import { describe, expect, it } from "vitest";
import { weaveMemberNews } from "@/lib/member-news-weave";

const s = (id: string, member = false) => ({ id, is_member_news: member });
const industry = (n: number) => Array.from({ length: n }, (_, i) => s(`s${i}`));
const members = (...ids: string[]) => ids.map((id) => s(id, true));
const first = () => 0; // fixed rand, so which candidates get picked is deterministic

describe("weaveMemberNews (GAPS A9.3)", () => {
  it("puts two member stories at the 2nd and 5th positions, keeping the carousel's length", () => {
    const out = weaveMemberNews({ carousel: industry(8), alsoInFold: industry(2), memberNews: members("m1", "m2", "m3"), rand: first });
    expect(out).toHaveLength(8);
    expect(out[0].is_member_news).toBe(false);
    expect(out[1].is_member_news).toBe(true);
    expect(out[4].is_member_news).toBe(true);
    expect(out.filter((x) => x.is_member_news)).toHaveLength(2);
  });

  it("pushes out the oldest industry tiles, never the newest", () => {
    const out = weaveMemberNews({ carousel: industry(8), alsoInFold: [], memberNews: members("m1", "m2"), rand: first });
    const kept = out.filter((x) => !x.is_member_news).map((x) => x.id);
    expect(kept).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
  });

  // REQUIREMENTS §7: roughly ≤20% member news — member stories already in the fold count first.
  it("only tops up to the cap, counting member stories already in the fold", () => {
    const carousel = [s("s0"), s("mA", true), ...industry(6).map((x) => ({ ...x, id: `t${x.id}` }))];
    const out = weaveMemberNews({ carousel, alsoInFold: industry(2), memberNews: members("m1", "m2"), rand: first });
    expect(out.filter((x) => x.is_member_news)).toHaveLength(2);

    const full = weaveMemberNews({ carousel, alsoInFold: [s("h", true)], memberNews: members("m1"), rand: first });
    expect(full).toEqual(carousel); // already 2 member stories in the fold
  });

  it("never repeats a story already in the fold", () => {
    const carousel = industry(8);
    const out = weaveMemberNews({ carousel, alsoInFold: [s("m1", true)], memberNews: members("m1", "m2"), rand: first });
    expect(out.map((x) => x.id)).not.toContain("m1");
    expect(out.map((x) => x.id)).toContain("m2");
  });

  it("returns the carousel unchanged with no member news to add", () => {
    const carousel = industry(8);
    expect(weaveMemberNews({ carousel, alsoInFold: [], memberNews: [] })).toEqual(carousel);
    expect(weaveMemberNews({ carousel: [], alsoInFold: [], memberNews: members("m1") })).toEqual([]);
  });

  // Rotation is uniform: over many renders every member story gets a turn.
  it("rotates across renders so every member story is shown", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      weaveMemberNews({ carousel: industry(8), alsoInFold: [], memberNews: members("m1", "m2", "m3", "m4", "m5") })
        .filter((x) => x.is_member_news).forEach((x) => seen.add(x.id));
    }
    expect([...seen].sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });
});
