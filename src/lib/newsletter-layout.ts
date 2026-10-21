/**
 * The shape of a newsletter issue, shared by the email (adapters/newsletter)
 * and the web version (/newsletters/[slug]) so the two can't drift.
 *
 * Gap review area 5 follows the live Mailchimp issues: the first item is the
 * lead story at full width, the rest sit two to a row under a "Sheeting Hot
 * News" heading, and adverts go *between* rows rather than stacked at the end.
 *
 * Placement is "after item N", 1-based with the lead as item 1. An advert with
 * its own `after_item` goes there (clamped to the issue's length, so removing a
 * story never strands a saved placement). The rest follow the live issues: the
 * first after item 3 (the lead plus the first row), the last just before the
 * footer, and any others spread evenly between.
 */

export const STORY_SECTION_HEADING = "Sheeting Hot News";

/** Where the automatic rule puts the first advert. */
const FIRST_AD_AFTER = 3;

/** For each advert, in the order given, the item it follows (0 only when the issue has no items). */
export function adSlots(itemCount: number, afterItems: (number | null)[]): number[] {
  const clamp = (n: number) => Math.min(Math.max(Math.trunc(n), 1), itemCount);
  if (itemCount <= 0) return afterItems.map(() => 0);

  const auto = afterItems.filter((n) => n == null).length;
  const first = Math.min(FIRST_AD_AFTER, itemCount);
  const autoSlots =
    auto === 1
      ? [first]
      : Array.from({ length: auto }, (_, i) => Math.round(first + ((itemCount - first) * i) / (auto - 1)));

  let next = 0;
  return afterItems.map((n) => (n == null ? autoSlots[next++] : clamp(n)));
}

export type IssueBlock<I, A> =
  | { kind: "lead"; item: I }
  | { kind: "heading" }
  /** One or two cards. A lone card is drawn full width. */
  | { kind: "row"; items: I[] }
  | { kind: "ad"; ad: A };

/**
 * The issue as a sequence of blocks. A row is closed early when an advert has
 * to go after its first card, so an advert never splits a row in two.
 */
export function issueBlocks<I, A extends { after_item: number | null }>(items: I[], ads: A[]): IssueBlock<I, A>[] {
  const slots = adSlots(items.length, ads.map((a) => a.after_item));
  const adsAfter = (n: number) => ads.filter((_, i) => slots[i] === n).map((ad): IssueBlock<I, A> => ({ kind: "ad", ad }));

  const blocks: IssueBlock<I, A>[] = [...adsAfter(0)];
  if (!items.length) return blocks;

  blocks.push({ kind: "lead", item: items[0] }, ...adsAfter(1));
  if (items.length > 1) blocks.push({ kind: "heading" });

  let row: I[] = [];
  for (let i = 1; i < items.length; i++) {
    row.push(items[i]);
    const after = adsAfter(i + 1);
    if (row.length === 2 || after.length || i === items.length - 1) {
      blocks.push({ kind: "row", items: row });
      row = [];
    }
    blocks.push(...after);
  }
  return blocks;
}

/**
 * The one "In association with" logo that goes in the masthead, and every
 * other advert. Only the first association logo is lifted out: the composer
 * allows one per issue, and any extra one from before that rule renders with
 * the banners rather than vanishing — it may be a paid slot.
 */
export function splitMastheadSponsor<A extends { format: string | null }>(ads: A[]): { sponsor: A | null; banners: A[] } {
  const index = ads.findIndex((a) => a.format === "association_logo");
  if (index < 0) return { sponsor: null, banners: ads };
  return { sponsor: ads[index], banners: ads.filter((_, i) => i !== index) };
}

/** Soft limits the composer counts against; neither blocks a save. */
export const SUBJECT_SOFT_MAX = 50;
export const PREVIEW_TEXT_SOFT_MAX = 90;
