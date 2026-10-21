import { describe, expect, it } from "vitest";
import { audienceDrift, missingChecks, PROOF_CHECKLIST, PROOF_KEYS, tickedKeys } from "@/lib/newsletter-proof";

describe("PROOF_CHECKLIST", () => {
  it("has unique keys, since they are what each issue stores", () => {
    expect(new Set(PROOF_KEYS).size).toBe(PROOF_KEYS.length);
    expect(PROOF_KEYS.length).toBe(PROOF_CHECKLIST.flatMap((g) => g.items).length);
  });
});

describe("tickedKeys / missingChecks", () => {
  it("treats anything that isn't a plain object as nothing ticked", () => {
    for (const stored of [null, undefined, "x", 3, ["story_links"]]) {
      expect(tickedKeys(stored).size).toBe(0);
      expect(missingChecks(stored)).toHaveLength(PROOF_KEYS.length);
    }
  });

  it("counts only known keys set to true", () => {
    const ticked = tickedKeys({ story_links: true, images: "true", spam_check: false, made_up: true });
    expect([...ticked]).toEqual(["story_links"]);
  });

  it("lists what's left in checklist order, and nothing once all are ticked", () => {
    const allButTwo = Object.fromEntries(PROOF_KEYS.slice(2).map((k) => [k, true]));
    expect(missingChecks(allButTwo).map((i) => i.key)).toEqual(PROOF_KEYS.slice(0, 2));
    expect(missingChecks(Object.fromEntries(PROOF_KEYS.map((k) => [k, true])))).toEqual([]);
  });
});

describe("audienceDrift", () => {
  it("has no answer without a baseline", () => {
    expect(audienceDrift(100, null)).toBeNull();
    expect(audienceDrift(100, undefined)).toBeNull();
    expect(audienceDrift(100, 0)).toBeNull();
  });

  it("allows exactly 5% either way, and flags anything beyond", () => {
    expect(audienceDrift(105, 100)).toEqual({ pct: 5, withinLimit: true });
    expect(audienceDrift(95, 100)).toEqual({ pct: -5, withinLimit: true });
    expect(audienceDrift(106, 100)?.withinLimit).toBe(false);
    expect(audienceDrift(94, 100)?.withinLimit).toBe(false);
  });
});
