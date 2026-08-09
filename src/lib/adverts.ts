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

export async function liveAdverts(format: "banner" | "supplier_logo"): Promise<LiveAdvert[]> {
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("advert_bookings")
    .select("advert:adverts(id, name, desktop_path, mobile_path, link_url, format, advertiser:advertisers(member:members(id, slug)))")
    .lte("starts_on", today)
    .gte("ends_on", today);
  return (data ?? [])
    .map((b) => b.advert)
    .filter((a): a is NonNullable<typeof a> => !!a && a.format === format)
    .map((a) => ({
      advertId: a.id,
      name: a.name,
      desktopPath: a.desktop_path,
      mobilePath: a.mobile_path,
      linkUrl: a.link_url,
      memberSlug: a.advertiser?.member?.slug ?? null,
      memberId: a.advertiser?.member?.id ?? null,
    }));
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

/** Advert click target: explicit link_url, else the advertiser's member page. */
export function advertHref(ad: LiveAdvert): string {
  return `/out/${ad.advertId}`;
}

export function resolveAdvertTarget(linkUrl: string | null, memberSlug: string | null): string {
  if (linkUrl) return linkUrl;
  if (memberSlug) return `/members/${memberSlug}`;
  return "/";
}
