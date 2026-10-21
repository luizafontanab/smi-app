import { describe, expect, it } from "vitest";
import { adSlots, issueBlocks, splitMastheadSponsor } from "@/lib/newsletter-layout";

const auto = (n: number) => Array.from({ length: n }, () => null);

describe("adSlots", () => {
  it("places nothing when there are no adverts", () => {
    expect(adSlots(9, [])).toEqual([]);
  });

  it("puts a single advert after item 3, the lead and the first row", () => {
    expect(adSlots(9, auto(1))).toEqual([3]);
  });

  it("puts two adverts after item 3 and last before the footer", () => {
    expect(adSlots(9, auto(2))).toEqual([3, 9]);
  });

  it("spreads a third advert between, as the live issues do", () => {
    expect(adSlots(9, auto(3))).toEqual([3, 6, 9]);
  });

  it("spreads five evenly between the first and the last", () => {
    expect(adSlots(11, auto(5))).toEqual([3, 5, 7, 9, 11]);
  });

  it("puts everything at the end of an issue shorter than three items", () => {
    expect(adSlots(2, auto(2))).toEqual([2, 2]);
    expect(adSlots(1, auto(1))).toEqual([1]);
  });

  it("puts adverts at the top of an issue with no items, so a paid slot still shows", () => {
    expect(adSlots(0, [null, 4])).toEqual([0, 0]);
  });

  it("honours an advert's own place and spreads only the automatic ones", () => {
    expect(adSlots(9, [5, null, null])).toEqual([5, 3, 9]);
  });

  it("clamps a place past the end to the last item, and below 1 to the first", () => {
    expect(adSlots(4, [12, 0])).toEqual([4, 1]);
  });
});

describe("issueBlocks", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const ad = (name: string, after_item: number | null = null) => ({ name, after_item });
  const shape = (blocks: ReturnType<typeof issueBlocks<number, { name: string; after_item: number | null }>>) =>
    blocks.map((b) => (b.kind === "lead" ? `lead ${b.item}` : b.kind === "row" ? `row ${b.items.join("+")}` : b.kind === "ad" ? `ad ${b.ad.name}` : "heading"));

  it("lays out a lead, the heading and two-up rows, adverts between rows", () => {
    expect(shape(issueBlocks(items(7), [ad("A"), ad("B")]))).toEqual([
      "lead 1", "heading", "row 2+3", "ad A", "row 4+5", "row 6+7", "ad B",
    ]);
  });

  it("closes a row early rather than splitting it around an advert", () => {
    expect(shape(issueBlocks(items(5), [ad("A", 4)]))).toEqual(["lead 1", "heading", "row 2+3", "row 4", "ad A", "row 5"]);
  });

  it("can put an advert straight after the lead", () => {
    expect(shape(issueBlocks(items(3), [ad("A", 1)]))).toEqual(["lead 1", "ad A", "heading", "row 2+3"]);
  });

  it("leaves a lone last card on its own row", () => {
    expect(shape(issueBlocks(items(4), []))).toEqual(["lead 1", "heading", "row 2+3", "row 4"]);
  });

  it("has no heading when the lead is the only item", () => {
    expect(shape(issueBlocks(items(1), [ad("A")]))).toEqual(["lead 1", "ad A"]);
  });

  it("still shows the adverts of an issue with no items", () => {
    expect(shape(issueBlocks([], [ad("A")]))).toEqual(["ad A"]);
  });
});

describe("splitMastheadSponsor", () => {
  it("lifts the first association logo out and keeps the rest as banners", () => {
    const ads = [
      { id: "b1", format: "newsletter_banner" },
      { id: "l1", format: "association_logo" },
      { id: "l2", format: "association_logo" },
    ];
    const { sponsor, banners } = splitMastheadSponsor(ads);
    expect(sponsor?.id).toBe("l1");
    // A second logo from before the one-per-issue rule may be paid for, so it renders rather than vanishing.
    expect(banners.map((a) => a.id)).toEqual(["b1", "l2"]);
  });

  it("has no sponsor without an association logo", () => {
    expect(splitMastheadSponsor([{ format: "newsletter_banner" }]).sponsor).toBeNull();
  });
});
