import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUTS } from "@/lib/blocks/defaults";
import { adSlotKeys, bodyAdSlotKeys, validateLayout, type PageLayout } from "@/lib/blocks/schema";

const story = (): PageLayout => structuredClone(DEFAULT_LAYOUTS.story);

describe("validateLayout", () => {
  it("accepts every default layout", () => {
    expect(validateLayout("story", DEFAULT_LAYOUTS.story)).toBeNull();
    expect(validateLayout("member_profile", DEFAULT_LAYOUTS.member_profile)).toBeNull();
    expect(validateLayout("featured_machine", DEFAULT_LAYOUTS.featured_machine)).toBeNull();
  });

  it("rejects a missing anchor", () => {
    const l = story();
    l.blocks = l.blocks.filter((b) => b.type !== "story_body");
    expect(validateLayout("story", l)).toMatch(/main content/);
  });

  it("rejects a duplicated anchor", () => {
    const l = story();
    l.blocks.push({ id: "dup", type: "story_body" });
    expect(validateLayout("story", l)).toMatch(/main content/);
  });

  it("rejects anchors out of canonical order", () => {
    const l = story();
    const hero = l.blocks.findIndex((b) => b.type === "story_hero");
    const body = l.blocks.findIndex((b) => b.type === "story_body");
    [l.blocks[hero], l.blocks[body]] = [l.blocks[body], l.blocks[hero]];
    expect(validateLayout("story", l)).toMatch(/in order/);
  });

  it("rejects props on ad blocks — neutrality firewall", () => {
    const l = story();
    const ad = l.blocks.find((b) => b.type === "ad_banner")!;
    ad.props = { advertiser: "acme" };
    expect(validateLayout("story", l)).toMatch(/rotation decides/);
  });

  it("rejects an ad as the first block", () => {
    const l = story();
    const i = l.blocks.findIndex((b) => b.type === "ad_banner");
    const [ad] = l.blocks.splice(i, 1);
    l.blocks.unshift(ad);
    expect(validateLayout("story", l)).toMatch(/open with an advert/);
  });

  it("rejects anchors belonging to another page type", () => {
    const l = structuredClone(DEFAULT_LAYOUTS.member_profile);
    l.blocks.push({ id: "x", type: "story_body" });
    expect(validateLayout("member_profile", l)).toMatch(/not allowed/);
  });

  it("rejects unknown types, bad back_link, bad limit, dup ids, oversize", () => {
    const l1 = story();
    l1.blocks.push({ id: "x", type: "marquee" as never });
    expect(validateLayout("story", l1)).toMatch(/not allowed/);

    const l2 = story();
    l2.blocks.find((b) => b.type === "back_link")!.props = { label: "Back", href: "https://evil.example" };
    expect(validateLayout("story", l2)).toMatch(/internal href/);

    const l3 = story();
    l3.blocks.find((b) => b.type === "latest_news")!.props = { limit: 99 };
    expect(validateLayout("story", l3)).toMatch(/1–8/);

    const l4 = story();
    l4.blocks.push({ ...l4.blocks.find((b) => b.type === "join_cta")! });
    expect(validateLayout("story", l4)).toMatch(/duplicate/);

    const l5 = story();
    for (let i = 0; i < 16; i++) l5.blocks.push({ id: `extra-${i}`, type: "join_cta" });
    expect(validateLayout("story", l5)).toMatch(/too many/);
  });

  it("rejects malformed input", () => {
    expect(validateLayout("story", null)).not.toBeNull();
    expect(validateLayout("story", { version: 2, blocks: [] })).not.toBeNull();
    expect(validateLayout("story", { version: 1, blocks: "nope" })).not.toBeNull();
  });
});

describe("adSlotKeys", () => {
  it("derives position-indexed keys per page type", () => {
    expect(adSlotKeys("story", DEFAULT_LAYOUTS.story)).toEqual(["story_ad_1", "story_ad_2"]);
    // no advert by default on a member's own page (fix list) — zero ad_banner blocks
    expect(adSlotKeys("member_profile", DEFAULT_LAYOUTS.member_profile)).toEqual([]);
    expect(adSlotKeys("featured_machine", DEFAULT_LAYOUTS.featured_machine)).toEqual(["machine_ad_1"]);
  });

  it("is stable regardless of block ids or props", () => {
    const l = story();
    l.blocks.forEach((b) => (b.id = `renamed-${b.id}`));
    expect(adSlotKeys("story", l)).toEqual(["story_ad_1", "story_ad_2"]);
  });
});

describe("bodyAdSlotKeys", () => {
  it("derives position-indexed keys from the break count", () => {
    expect(bodyAdSlotKeys(0)).toEqual([]);
    expect(bodyAdSlotKeys(2)).toEqual(["story_body_ad_1", "story_body_ad_2"]);
  });

  it("clamps a negative count — an empty body splits to no segments", () => {
    expect(bodyAdSlotKeys(-1)).toEqual([]);
  });

  it("never collides with the layout's own slot keys", () => {
    const layoutKeys = adSlotKeys("story", DEFAULT_LAYOUTS.story);
    // BlockRenderer walks its keys by index; an overlap would mis-assign adverts
    expect(layoutKeys.filter((k) => bodyAdSlotKeys(3).includes(k))).toEqual([]);
  });
});
