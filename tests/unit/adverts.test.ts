import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bookingPhase, dealSlots, RENDERABLE_BOOKING_STATUSES, resolveAdvertTarget, uniformShuffle, type LiveAdvert } from "@/lib/adverts";

const ad = (i: number): LiveAdvert => ({
  advertId: `ad-${i}`,
  name: `Advert ${i}`,
  desktopPath: "d",
  mobilePath: "m",
  linkUrl: null,
  memberSlug: `member-${i}`,
  memberId: `mid-${i}`,
});

describe("rotation neutrality (the contractual rule: no advertiser can be favoured)", () => {
  it("every advert has a statistically equal chance of the first position", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ad(i));
    const runs = 20_000;
    const firstCounts = new Map<string, number>();
    for (let r = 0; r < runs; r++) {
      const first = uniformShuffle(pool)[0].advertId;
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
    }
    const expected = runs / pool.length; // 2500
    for (const advert of pool) {
      const count = firstCounts.get(advert.advertId) ?? 0;
      // ±10% tolerance — generous for 20k runs; catches any systematic bias
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });

  it("no bias input exists: shuffle output depends only on the RNG, never advert fields", () => {
    const pool = [ad(1), ad(2), ad(3)];
    const fixed = () => 0.42;
    const a = uniformShuffle(pool, fixed).map((x) => x.advertId);
    const renamed = pool.map((p) => ({ ...p, name: "BUY-TOP-SLOT-£££" }));
    const b = uniformShuffle(renamed, fixed).map((x) => x.advertId);
    expect(a).toEqual(b);
  });

  it("the rotation module's code never reads a bias-capable field — checked, not just commented", () => {
    // Turns the migration comment "this column may never be read by the
    // rotation path" into something CI fails on, rather than a promise that
    // only holds until someone forgets it. Strips comments first: the file's
    // own doc comments name "weight/priority/bid" precisely to forbid them,
    // and a naive scan would trip over its own warning label.
    const path = fileURLToPath(new URL("../../src/lib/adverts.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const forbidden = ["is_bundle_account", "bundle_id", "weight", "priority", "bid"];
    for (const term of forbidden) {
      expect(code.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

describe("dealSlots", () => {
  it("fills every slot and never repeats an advert on the page until the pool is exhausted", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ad(i));
    const slots = dealSlots(pool, ["home_1", "home_2", "home_3", "siderail_a", "siderail_b"]);
    const primaries = [...slots.values()].map((v) => v[0].advertId);
    expect(new Set(primaries).size).toBe(5); // 8 adverts, 5 slots → all primaries distinct
    for (const bucket of slots.values()) {
      expect(bucket.length).toBeGreaterThan(0);
      expect(bucket.length).toBeLessThanOrEqual(3);
    }
  });

  it("handles fewer adverts than slots without duplicating within a slot", () => {
    const pool = [ad(1), ad(2)];
    const slots = dealSlots(pool, ["a", "b", "c"]);
    for (const bucket of slots.values()) {
      const ids = bucket.map((x) => x.advertId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("returns empty buckets for an empty pool (page renders without adverts)", () => {
    const slots = dealSlots([], ["a", "b"]);
    expect([...slots.values()].every((v) => v.length === 0)).toBe(true);
  });

  it("covers a story's layout slots and in-body breaks in ONE deal", () => {
    // The story page combines adSlotKeys() and bodyAdSlotKeys() into a single
    // call precisely so this holds. Dealing the in-body keys separately would
    // let one advert take two positions on the page — a de-facto weighting.
    const pool = Array.from({ length: 4 }, (_, i) => ad(i));
    const slots = dealSlots(pool, ["story_ad_1", "story_ad_2", "story_body_ad_1"]);
    const primaries = [...slots.values()].map((v) => v[0].advertId);
    expect(new Set(primaries).size).toBe(primaries.length);
  });
});

describe("advert click target", () => {
  it("explicit link wins; falls back to the member page (clicks register on their charts)", () => {
    expect(resolveAdvertTarget("https://x.co.uk", "acme")).toBe("https://x.co.uk");
    expect(resolveAdvertTarget(null, "acme")).toBe("/member/acme");
    expect(resolveAdvertTarget(null, null)).toBe("/");
  });
});

describe("the approval gate and the render predicate", () => {
  it("only scheduled and live are renderable — a draft or sent-back run never reaches the site", () => {
    // Guards the property that used to be absent entirely: before the lifecycle
    // existed, ANY booking row whose dates spanned today rendered publicly.
    expect([...RENDERABLE_BOOKING_STATUSES]).toEqual(["scheduled", "live"]);
    for (const status of ["draft", "awaiting_approval", "review_required", "ended"]) {
      expect(RENDERABLE_BOOKING_STATUSES).not.toContain(status);
    }
  });

  it("an approved run still renders only inside its term, so a missed nightly sweep cannot leak it", () => {
    const term = { status: "live", starts_on: "2026-03-01", ends_on: "2026-03-31" };
    expect(bookingPhase(term, "2026-03-15")).toBe("live");
    // sweep hasn't relabelled these yet — the dates must still decide
    expect(bookingPhase(term, "2026-04-01")).toBe("ended");
    expect(bookingPhase({ ...term, status: "scheduled" }, "2026-02-01")).toBe("upcoming");
    expect(bookingPhase({ ...term, status: "scheduled" }, "2026-03-15")).toBe("live");
  });

  it("a terminal or unapproved status beats the dates, however they fall", () => {
    const spanning = { starts_on: "2026-03-01", ends_on: "2026-03-31" };
    const today = "2026-03-15";
    expect(bookingPhase({ ...spanning, status: "draft" }, today)).toBe("draft");
    expect(bookingPhase({ ...spanning, status: "awaiting_approval" }, today)).toBe("awaiting");
    expect(bookingPhase({ ...spanning, status: "review_required" }, today)).toBe("changes_needed");
    // ended stays ended even if someone edits the end date back into the future
    expect(bookingPhase({ ...spanning, status: "ended" }, today)).toBe("ended");
  });
});
