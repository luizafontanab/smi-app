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
export const DIARY_HEADING = "Events diary";
export const DIRECTORY_HEADING = "Supplier directory";

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

/**
 * Formats with room for only one per issue: the masthead has one sponsor
 * spot, and the SOP has one sponsored story.
 */
export const ONE_PER_ISSUE_FORMATS: ReadonlySet<string> = new Set(["association_logo", "sponsored_story"]);

/** Soft limits the composer counts against; neither blocks a save. */
export const SUBJECT_SOFT_MAX = 50;
export const PREVIEW_TEXT_SOFT_MAX = 90;

/** Gap review area 5 slice B: the SOP's soft word ranges. */
export const STORY_SUMMARY_WORDS = { min: 40, max: 60 } as const;
export const SPONSORED_STORY_MAX_WORDS = 80;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** How far ahead the events diary looks from the issue's send date. */
export const DIARY_DAYS = 30;

/**
 * The events diary's date range, as `YYYY-MM-DD` (events.starts_on is a date):
 * from the day the issue goes out — scheduled, sent, or today for a draft —
 * to DIARY_DAYS later. The web copy of a sent issue keeps the diary it was
 * sent with rather than drifting with today's date.
 */
export function diaryWindow(sendAt: string | null | undefined, now = new Date()): { from: string; to: string } {
  const start = sendAt ? new Date(sendAt) : now;
  const from = Number.isNaN(start.getTime()) ? now : start;
  const to = new Date(from.getTime() + DIARY_DAYS * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * "4 November" or "4–6 November" or "28 November – 2 December", for the
 * diary. starts_on/ends_on are date columns, so formatted in UTC or they shift
 * a day back west of Greenwich (as in components/cards.tsx).
 */
export function diaryDate(startsOn: string, endsOn?: string | null): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  if (!endsOn || endsOn <= startsOn) return fmt(startsOn, { day: "numeric", month: "long" });
  if (startsOn.slice(0, 7) === endsOn.slice(0, 7)) return `${fmt(startsOn, { day: "numeric" })}–${fmt(endsOn, { day: "numeric", month: "long" })}`;
  return `${fmt(startsOn, { day: "numeric", month: "long" })} – ${fmt(endsOn, { day: "numeric", month: "long" })}`;
}
