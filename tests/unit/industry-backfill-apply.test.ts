import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Migration 20261016000030: apply_industry_backfill writes the backfill's
 * whole plan in one transaction. The unit tests (industry-backfill.test.ts)
 * show the script makes exactly one call; this shows the call is all or
 * nothing against the real database — the property that lets a failed
 * production run simply be run again.
 *
 * Every call here is made to FAIL, which is what keeps the file safe beside
 * the other integration suites: on a correct database a failed call changes
 * nothing, so nobody else's rows move. (A succeeding call replaces
 * member_industries wholesale and would wipe the links other suites create
 * mid-run — so the success path is covered by the unit tests and the
 * backfill's own dry run, not here.)
 *
 * The evidence is a sentinel: one throwaway member with one link, owned by
 * this file. Each failing plan asks for no links at all, so a clear that
 * stuck would take the sentinel with it.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe.skipIf(!KEY)("apply_industry_backfill (migration 20261016000030)", () => {
  const db = createClient(URL_, KEY ?? "skipped", { auth: { persistSession: false } });
  const EMPTY = { links: [], members: [], stories: [], videos: [], events: [] };
  let memberId = "";
  let industryId = 0;
  let eventId: string | null = null;

  const sentinelSurvives = async () => {
    const { data, error } = await db.from("member_industries").select("member_id").eq("member_id", memberId).eq("industry_id", industryId);
    expect(error).toBeNull();
    return data?.length === 1;
  };

  beforeAll(async () => {
    const tag = Date.now().toString(36);
    const { data: industry, error: iErr } = await db.from("industries").select("id").order("sort_order").limit(1).single();
    if (iErr) throw iErr;
    industryId = industry.id;
    const { data: member, error: mErr } = await db
      .from("members")
      .insert({ slug: `backfill-apply-test-${tag}`, name: "Backfill Apply Test Ltd", status: "draft" })
      .select("id")
      .single();
    if (mErr) throw mErr;
    memberId = member.id;
    const { error: lErr } = await db.from("member_industries").insert({ member_id: memberId, industry_id: industryId });
    if (lErr) throw lErr;
    const { data: event } = await db.from("events").select("id").order("id").limit(1).maybeSingle();
    eventId = event?.id ?? null;
  });

  afterAll(async () => {
    // cascades to its member_industries row
    if (memberId) await db.from("members").delete().eq("id", memberId);
  });

  it("changes nothing when its last statement fails", async () => {
    expect(eventId, "needs a seeded event").not.toBeNull();
    // No links — so a clear that stuck would remove the sentinel — and an
    // event pointed at an industry that doesn't exist, which fails its
    // foreign key in the very last update, after everything else has run.
    const { error } = await db.rpc("apply_industry_backfill", {
      plan: { ...EMPTY, events: [{ id: eventId, industry_id: -1 }] },
    });
    expect(error?.message).toMatch(/foreign key/);
    expect(await sentinelSurvives()).toBe(true);
  });

  it("changes nothing when the link insert fails part-way", async () => {
    const { error } = await db.rpc("apply_industry_backfill", {
      plan: { ...EMPTY, links: [{ member_id: memberId, industry_id: industryId }, { member_id: memberId, industry_id: -1 }] },
    });
    expect(error?.message).toMatch(/foreign key/);
    expect(await sentinelSurvives()).toBe(true);
  });

  it("refuses a plan missing a table rather than reading it as 'clear them all'", async () => {
    const { error } = await db.rpc("apply_industry_backfill", { plan: { links: [], members: [], stories: [], videos: [] } });
    expect(error?.message).toMatch(/plan\.events must be an array/);
    expect(await sentinelSurvives()).toBe(true);
  });

  it.skipIf(!ANON_KEY)("is not callable with the publishable key", async () => {
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("apply_industry_backfill", { plan: EMPTY });
    expect(error?.code).toBe("42501");
    expect(await sentinelSurvives()).toBe(true);
  });
});
