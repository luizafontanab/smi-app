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

export async function liveAdverts(format: "banner" | "supplier_logo"): Promise<LiveAdvert[]> {
  if (await adPreview()) return [];
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
  if (memberSlug) return `/members/${memberSlug}`;
  return "/";
}
