import { RENDERABLE_BOOKING_STATUSES } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { serviceDb } from "@/lib/db/server";

/**
 * Advert impression beacon. The browser posts the ids of adverts that actually
 * loaded and were actually on screen — see components/AdCreative.tsx.
 *
 * Impressions used to be written server-side at render, which counted every
 * slot on the page whether or not the reader ever scrolled to it, and counted
 * adverts an ad blocker had eaten. Impressions are the headline metric sold to
 * advertisers (REQUIREMENTS.md §5), and analytics must be real (lib/analytics.ts),
 * so the count has to come from what was displayed, not from what was intended.
 *
 * Named /api/seen deliberately: /impression, /track, /pixel and /beacon are all
 * in the common blocklists, which would put us straight back to undercounting.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_BEACON = 20;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const raw = (body as { ids?: unknown })?.ids;
  const wanted = Array.isArray(raw)
    ? [...new Set(raw.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, MAX_PER_BEACON)
    : [];
  if (wanted.length === 0) return new Response(null, { status: 204 });

  // The client says what it saw, so trust it only as far as the booking allows:
  // drop anything that is not a real advert with a live booking today, or an
  // invented id could pad the number we invoice against.
  // Must stay identical to liveBookings() in lib/adverts.ts — hence the shared
  // constant. If validation and rendering ever disagree we either drop real
  // impressions or bill for adverts that never showed.
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("advert_bookings")
    .select("advert_id")
    .in("advert_id", wanted)
    .in("status", RENDERABLE_BOOKING_STATUSES)
    .lte("starts_on", today)
    .gte("ends_on", today);
  if (error) console.error("impression validation failed", error);

  const live = [...new Set((data ?? []).map((b) => b.advert_id))];
  if (live.length === 0) return new Response(null, { status: 204 });

  const ctx = await requestContext();
  record(live.map((advert_id) => ({ kind: "ad_impression" as const, advert_id, ...ctx })));
  return new Response(null, { status: 204 });
}
