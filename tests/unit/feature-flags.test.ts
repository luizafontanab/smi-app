import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_FLAGS, featureFlagKey, featureFlags, isFeatureEnabled, isFeatureFlag } from "@/lib/feature-flags";
import { serviceDb } from "@/lib/db/server";
import { resetDbServerMocks } from "../stubs/db-server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(resetDbServerMocks);

/** What the `settings` read returns. */
function stored(result: DbResult) {
  const settings = queryBuilder(result);
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ settings: () => settings }) })));
  return settings;
}

describe("featureFlags", () => {
  it("gives every flag its default when no row exists — member Leads ships off", async () => {
    stored(dbOk([]));
    expect(FEATURE_FLAGS.member_leads.default).toBe(false);
    expect(await isFeatureEnabled("member_leads")).toBe(false);
  });

  it("the story crawler ships off, and one flag's row never sets another", async () => {
    expect(FEATURE_FLAGS.story_crawler.default).toBe(false);
    stored(dbOk([{ key: "feature:story_crawler", value: true }]));
    expect(await featureFlags()).toEqual({ member_leads: false, story_crawler: true });
  });

  it("reads each flag from its own feature: row, both ways", async () => {
    const settings = stored(dbOk([{ key: "feature:member_leads", value: true }]));
    expect(await isFeatureEnabled("member_leads")).toBe(true);
    expect(settings.in).toHaveBeenCalledWith("key", ["feature:member_leads", "feature:story_crawler"]);

    stored(dbOk([{ key: "feature:member_leads", value: false }]));
    expect(await isFeatureEnabled("member_leads")).toBe(false);
  });

  it("ignores a stored value that isn't a boolean", async () => {
    stored(dbOk([{ key: "feature:member_leads", value: "yes" }]));
    expect(await isFeatureEnabled("member_leads")).toBe(false);
  });

  it("ignores rows for flags that aren't in the registry", async () => {
    stored(dbOk([{ key: "feature:retired_thing", value: true }]));
    expect(await featureFlags()).toEqual({ member_leads: false, story_crawler: false });
  });

  // A hidden feature must stay hidden when settings can't be read.
  it("falls back to defaults on a read error or a thrown client", async () => {
    stored(dbError("boom"));
    expect(await isFeatureEnabled("member_leads")).toBe(false);

    vi.mocked(serviceDb).mockImplementation(() => { throw new Error("db down"); });
    expect(await isFeatureEnabled("member_leads")).toBe(false);
  });
});

describe("isFeatureFlag / featureFlagKey", () => {
  it("accepts only names in the registry", () => {
    expect(isFeatureFlag("member_leads")).toBe(true);
    expect(isFeatureFlag("not_a_flag")).toBe(false);
    expect(isFeatureFlag("toString")).toBe(false);
    expect(isFeatureFlag(null)).toBe(false);
  });

  it("namespaces the settings key", () => {
    expect(featureFlagKey("member_leads")).toBe("feature:member_leads");
  });
});
