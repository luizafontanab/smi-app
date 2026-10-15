import "server-only";
import { serviceDb } from "./db/server";
import { must } from "./db/must";
import type { SpotBooking } from "./adverts";
import { BANNER_SPOTS_KEY, resolveBannerSpots } from "./banner-spots";

/**
 * Console read for the banner-spot view: how many spots we sell, and every
 * banner booking still running or to come. Console-only, so it throws through
 * must() into the console error boundary rather than rendering "0 sold" off a
 * failed query.
 *
 * Every status comes back — the occupancy helpers in lib/adverts.ts decide
 * what counts as sold and what is pending, with the public site's own rule.
 */
export async function bannerInventory(today: string, label: string): Promise<{ spots: number; bookings: SpotBooking[] }> {
  const db = serviceDb();
  const [setting, rows] = await Promise.all([
    must(db.from("settings").select("value").eq("key", BANNER_SPOTS_KEY).maybeSingle(), `${label} banner spots`),
    must(
      db.from("advert_bookings").select("status, starts_on, ends_on, advert:adverts(format)").gte("ends_on", today),
      `${label} banner bookings`,
    ),
  ]);
  return {
    spots: resolveBannerSpots(setting?.value),
    bookings: (rows ?? [])
      .filter((b) => b.advert?.format === "banner")
      .map(({ status, starts_on, ends_on }) => ({ status, starts_on, ends_on })),
  };
}
