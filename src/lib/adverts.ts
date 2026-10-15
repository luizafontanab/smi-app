import { cookies } from "next/headers";
import { serviceDb } from "./db/server";
import { websiteUrl } from "./website-url";

/**
 * Advert selection — the neutrality-critical path.
 *
 * HARD RULE (requirements/04-advert-engine.md): rotation is random-uniform.
 * Every live booking has an equal chance in every slot on every page load.
 * There is no weight/priority/bid input anywhere in this module, and none
 * may ever be added.
 */

export type LiveAdvert = {
  advertId: string;
  name: string;
  desktopPath: string;
  mobilePath: string;
  linkUrl: string | null;
  memberSlug: string | null;
  memberId: string | null;
};

/**
 * Preview switch for the unsold state, set from /console/adverts. Empties the
 * inventory for this browser only, so every slot falls back to its placeholder
 * and you can check slot footprints without wiping the seeded adverts.
 */
export const AD_PREVIEW_COOKIE = "smi-ads";

export async function adPreview(): Promise<boolean> {
  const store = await cookies();
  return store.get(AD_PREVIEW_COOKIE)?.value === "empty";
}

/**
 * Whether empty slots draw their dashed footprint. On in dev, and anywhere the
 * preview cookie is set — the cookie is the real gate, and only /console/adverts
 * (auth-gated) sets it, so no reader ever sees a hollow box. Deliberately not
 * NODE_ENV alone: that made the placeholders unreachable in a `next start`
 * demo build, and an empty state you cannot reach is an empty state you cannot
 * trust.
 */
export async function showAdPlaceholders(): Promise<boolean> {
  return process.env.NODE_ENV !== "production" || (await adPreview());
}

/** Mirrors the adverts.format check constraint. Mobile is artwork, not a format. */
export type AdvertFormat =
  | "banner"
  // 830×170 — the grid homepage's narrow column. Its own format, not a render
  // variant: an advert row has one desktop_path and dealSlots pools every
  // 'banner' booking across every banner slot, so the two sizes cannot share
  // a pool without the narrow artwork leaking into full-width positions.
  | "banner_narrow"
  | "supplier_logo"
  | "newsletter_banner"
  | "association_logo"
  | "skyscraper"
  | "mpu"
  | "in_feed";

/**
 * The statuses that may appear on the public site. Exported because the render
 * predicate must be identical everywhere it is asked — most importantly in
 * /api/seen, where a disagreement means either dropping real impressions or
 * recording ones for adverts that never showed.
 */
export const RENDERABLE_BOOKING_STATUSES = ["scheduled", "live"] as const;

/**
 * Status AND dates, deliberately, and neither alone.
 *
 * Status alone would take every advert dark the moment a nightly sweep is
 * missed — prod cron runs once at 03:00 and fails closed when CRON_SECRET is
 * unset, so "stale by a week" is a real state. Dates alone is what this used to
 * do, and it let any draft or sent-back booking onto the site the moment its
 * dates matched.
 *
 * The rule: an approved booking renders only inside its own term. The daily job
 * records the transition; it never authorises it. So `scheduled` and `live` are
 * deliberately indistinguishable here — a booking whose start date has arrived
 * renders even if the sweep has not relabelled it yet. Narrowing this to
 * `live` would reintroduce every cron-failure mode above.
 */
async function liveBookings(): Promise<(LiveAdvert & { format: string })[]> {
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("advert_bookings")
    .select("advert:adverts(id, name, desktop_path, mobile_path, link_url, format, member:members(id, slug))")
    .in("status", RENDERABLE_BOOKING_STATUSES)
    .lte("starts_on", today)
    .gte("ends_on", today);
  // Never swallow this. A schema mismatch here returns null data, which would
  // empty every slot on the site with no exception and no 500 — an outage that
  // looks exactly like "nothing is booked".
  if (error) console.error("liveBookings failed", error);

  const seen = new Set<string>();
  return (data ?? [])
    .map((b) => b.advert)
    .filter((a): a is NonNullable<typeof a> => !!a)
    // One advert booked twice over the same days would otherwise enter the
    // rotation array twice and take double share — a weight, in the module that
    // forbids weights. The DB has an exclusion constraint against it; this keeps
    // the invariant if that constraint is ever dropped.
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .map((a) => ({
      advertId: a.id,
      name: a.name,
      desktopPath: a.desktop_path,
      mobilePath: a.mobile_path,
      linkUrl: a.link_url,
      memberSlug: a.member?.slug ?? null,
      memberId: a.member?.id ?? null,
      format: a.format,
    }));
}

/** What to call a booking in the console. The public site uses liveBookings. */
export function bookingPhase(
  booking: { status: string; starts_on: string; ends_on: string },
  today: string,
): "draft" | "awaiting" | "changes_needed" | "awaiting_payment" | "upcoming" | "live" | "ended" {
  switch (booking.status) {
    case "draft": return "draft";
    case "awaiting_approval": return "awaiting";
    // Approved and priced, waiting on the member to pay (6 Oct). Its own
    // phase: falling through to the date logic below would call an unpaid,
    // unshown run "live".
    case "awaiting_payment": return "awaiting_payment";
    case "review_required": return "changes_needed";
    case "ended": return "ended";
    default:
      // scheduled/live: the term decides, matching what the site actually shows
      if (booking.starts_on > today) return "upcoming";
      return booking.ends_on < today ? "ended" : "live";
  }
}

export async function liveAdverts(format: AdvertFormat): Promise<LiveAdvert[]> {
  if (await adPreview()) return [];
  return (await liveBookings()).filter((a) => a.format === format);
}

/**
 * Every requested format from a single round trip. A page that carries banners,
 * logos, a skyscraper and two boxes wants one query, not five — the bookings
 * table is the same for all of them.
 */
export async function liveAdvertsByFormat<F extends AdvertFormat>(formats: readonly F[]): Promise<Record<F, LiveAdvert[]>> {
  const out = Object.fromEntries(formats.map((f) => [f, [] as LiveAdvert[]])) as Record<F, LiveAdvert[]>;
  if (await adPreview()) return out;
  const wanted = new Set<string>(formats);
  for (const a of await liveBookings()) {
    if (wanted.has(a.format)) out[a.format as F].push(a);
  }
  return out;
}

/**
 * How many banners each position cycles through on one page load (A2.10). Each
 * position is a carousel of this many (src/components/AdCarousel.tsx); it is
 * not a sales number — what we sell is the sitewide banner-spot count, a
 * setting (bannerSpots() in lib/queries.ts).
 */
export const BANNERS_PER_POSITION = 3;

/** Fisher–Yates on a uniform PRNG; slots pick the first N of an unbiased shuffle. */
export function uniformShuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deal live banners across the page's positions for one request: one unbiased
 * shuffle, dealt round-robin, so frame r of position k is
 * shuffled[(r·P + k) mod n] for P positions and n banners.
 *
 * The property that buys: the carousels advance in lockstep (one shared ticker
 * in AdCarousel), so the banners on screen at any one moment are P consecutive
 * entries of the shuffle — all different whenever n ≥ P. With fewer live
 * banners than positions a repeat on the page is unavoidable.
 */
export function dealSlots(adverts: LiveAdvert[], slotKeys: string[], perSlot = BANNERS_PER_POSITION): Map<string, LiveAdvert[]> {
  const shuffled = uniformShuffle(adverts);
  const out = new Map<string, LiveAdvert[]>();
  slotKeys.forEach((key) => out.set(key, []));
  if (shuffled.length === 0) return out;
  let i = 0;
  for (let round = 0; round < perSlot; round++) {
    for (const key of slotKeys) {
      const bucket = out.get(key)!;
      if (bucket.length < shuffled.length) bucket.push(shuffled[i % shuffled.length]);
      i++;
    }
  }
  return out;
}

/**
 * Banner spots: one sitewide number, shown against bookings and never enforced.
 *
 * A booking is "sold" onto a day by the same rule the public site uses to show
 * it — a renderable status and a term covering that day — so the console's
 * count cannot disagree with what readers see. Bookings awaiting approval are
 * reported separately: they are a decision Jas still has to make, not a sale.
 */
export type SpotBooking = { status: string; starts_on: string; ends_on: string };

const SOLD_STATUSES = new Set<string>(RENDERABLE_BOOKING_STATUSES);

const covers = (b: SpotBooking, day: string) => b.starts_on <= day && b.ends_on >= day;

/** Every YYYY-MM-DD from `from` to `to` inclusive, in UTC like the rest of the term maths. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Banner bookings sold onto one day. */
export function soldOn(bookings: SpotBooking[], day: string): number {
  return bookings.filter((b) => SOLD_STATUSES.has(b.status) && covers(b, day)).length;
}

/** The busiest day in [from, to], first one on a tie; day is null when nothing is sold. */
export function peakSold(bookings: SpotBooking[], from: string, to: string): { count: number; day: string | null } {
  let best: { count: number; day: string | null } = { count: 0, day: null };
  for (const day of eachDay(from, to)) {
    const count = soldOn(bookings, day);
    if (count > best.count) best = { count, day };
  }
  return best;
}

export type MonthOccupancy = {
  /** YYYY-MM */
  month: string;
  /** Busiest day of the month (from `today` onward in the current month). */
  peak: { count: number; day: string | null };
  /** Bookings awaiting approval or payment whose term touches the month — not sold yet, but spoken for. */
  pending: number;
};

const PENDING_STATUSES = new Set(["awaiting_approval", "awaiting_payment"]);

/** The next `months` calendar months from today, busiest day per month. */
export function bannerOccupancy(bookings: SpotBooking[], today: string, months = 6): MonthOccupancy[] {
  const out: MonthOccupancy[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = 0; i < months; i++) {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(y, m + i, 0)).toISOString().slice(0, 10);
    const month = first.toISOString().slice(0, 7);
    const from = i === 0 ? today : first.toISOString().slice(0, 10);
    out.push({
      month,
      peak: peakSold(bookings, from, last),
      pending: bookings.filter((b) => PENDING_STATUSES.has(b.status) && b.starts_on <= last && b.ends_on >= from).length,
    });
  }
  return out;
}

/**
 * Advert click target: explicit link_url, else the advertiser's member page.
 * Deliberately /visit/ — see the note in src/app/visit/[id]/route.ts before
 * changing it to anything containing "ad", "click" or "out".
 */
export function advertHref(ad: LiveAdvert): string {
  return `/visit/${ad.advertId}`;
}

/**
 * Where /visit/[id] sends the reader. The stored link_url goes through
 * websiteUrl() here, not only on save: rows saved before the console validated
 * it can hold "www.acme.co.uk" — a RELATIVE redirect, to /visit/www.acme.co.uk —
 * or a non-http scheme, and the member dashboard's advert form still stores it
 * as typed. A link that can't be made a web address counts as no link at all,
 * so the click lands on the member page or home rather than nowhere.
 */
export function resolveAdvertTarget(linkUrl: string | null, memberSlug: string | null): string {
  const href = websiteUrl(linkUrl);
  if (href) return href;
  if (memberSlug) return `/member/${memberSlug}`;
  return "/";
}
