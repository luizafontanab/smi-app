import { cookies } from "next/headers";
import { serviceDb } from "./db/server";

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
): "draft" | "awaiting" | "changes_needed" | "upcoming" | "live" | "ended" {
  switch (booking.status) {
    case "draft": return "draft";
    case "awaiting_approval": return "awaiting";
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
 * Uniformly pick one of a slot's already-dealt adverts (A2.10). A slot shows
 * one advert per page load, not all ~3 at once and not a rotating carousel
 * within one view — the pick is made once per request, same as the shuffle
 * that fed it, so it stays static for the duration of that load.
 */
export function pickOne<T>(items: T[], rand: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rand() * items.length)];
}

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
 * Deal live banners across the page's slots for one request:
 * one unbiased shuffle, dealt round-robin so a banner never appears twice
 * on the same page until all others have appeared.
 */
export function dealSlots(adverts: LiveAdvert[], slotKeys: string[], perSlot = 3): Map<string, LiveAdvert[]> {
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
 * Advert click target: explicit link_url, else the advertiser's member page.
 * Deliberately /visit/ — see the note in src/app/visit/[id]/route.ts before
 * changing it to anything containing "ad", "click" or "out".
 */
export function advertHref(ad: LiveAdvert): string {
  return `/visit/${ad.advertId}`;
}

export function resolveAdvertTarget(linkUrl: string | null, memberSlug: string | null): string {
  if (linkUrl) return linkUrl;
  if (memberSlug) return `/member/${memberSlug}`;
  return "/";
}
