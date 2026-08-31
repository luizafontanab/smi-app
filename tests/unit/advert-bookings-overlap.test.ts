import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * The DB-level guarantee that `decideAdvertBooking` (console/actions.ts) now
 * depends on: approving a booking that would overlap another already-scheduled
 * run on the same advert must be REJECTED by Postgres, not silently accepted.
 * Before that action checked the update's error, an overlap here produced a
 * false "approved" audit row and a "your advert is scheduled" email while the
 * booking stayed stuck `awaiting_approval` — this is the constraint that
 * rejection relies on actually firing.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!KEY)("advert_bookings_no_overlap", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  let memberId = "";
  let advertId = "";

  beforeAll(async () => {
    const tag = Date.now().toString(36);
    const { data: member } = await db.from("members").insert({
      slug: `overlap-test-${tag}`,
      name: "Overlap Test Ltd",
      status: "draft",
    }).select("id").single();
    memberId = member!.id;
    const { data: advert } = await db.from("adverts").insert({
      member_id: memberId,
      name: "Overlap Test Advert",
      format: "banner",
      desktop_path: "d",
      mobile_path: "m",
    }).select("id").single();
    advertId = advert!.id;
  });

  afterAll(async () => {
    if (advertId) await db.from("advert_bookings").delete().eq("advert_id", advertId);
    if (advertId) await db.from("adverts").delete().eq("id", advertId);
    if (memberId) await db.from("members").delete().eq("id", memberId);
  });

  it("rejects a second scheduled booking on the same advert that overlaps an existing one", async () => {
    const { error: firstError } = await db.from("advert_bookings").insert({
      advert_id: advertId,
      starts_on: "2026-06-01",
      ends_on: "2026-06-30",
      status: "scheduled",
      source: "admin",
      approved_at: new Date().toISOString(),
    });
    expect(firstError).toBeNull();

    const { error: secondError } = await db.from("advert_bookings").insert({
      advert_id: advertId,
      starts_on: "2026-06-15", // overlaps the first run
      ends_on: "2026-07-15",
      status: "scheduled",
      source: "admin",
      approved_at: new Date().toISOString(),
    });
    // This is the exact string decideAdvertBooking's error handling matches on
    // to show a friendly message instead of the raw Postgres error.
    expect(secondError?.message).toContain("advert_bookings_no_overlap");
  });

  it("allows a renewal that starts the day the previous run ends (the partial WHERE's point)", async () => {
    const { error: firstError } = await db.from("advert_bookings").insert({
      advert_id: advertId,
      starts_on: "2026-08-01",
      ends_on: "2026-08-31",
      status: "live",
      source: "admin",
      approved_at: new Date().toISOString(),
    });
    expect(firstError).toBeNull();

    const { error: renewalError } = await db.from("advert_bookings").insert({
      advert_id: advertId,
      starts_on: "2026-09-01",
      ends_on: "2026-09-30",
      status: "scheduled",
      source: "admin",
      approved_at: new Date().toISOString(),
    });
    expect(renewalError).toBeNull();
  });

  it("does not block an overlapping run that is only awaiting_approval, not yet scheduled/live", async () => {
    // The exclusion constraint is scoped to status in (scheduled, live) on
    // purpose — two members can each submit a request for the same window,
    // and only approval (which the app must then arbitrate, see
    // decideAdvertBooking) decides who actually gets it.
    const { error } = await db.from("advert_bookings").insert({
      advert_id: advertId,
      starts_on: "2026-06-10",
      ends_on: "2026-06-20",
      status: "awaiting_approval",
      source: "member",
    });
    expect(error).toBeNull();
  });
});
