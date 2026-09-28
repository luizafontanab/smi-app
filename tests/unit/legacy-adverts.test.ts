import { describe, expect, it } from "vitest";
import { planLegacyAdverts, type LegacyAdvertRow } from "../../scripts/lib/legacy-adverts";

// Shapes and dates from the real adverts.seed.json (legacy A0 and A4).
const row = (over: Partial<LegacyAdvertRow> = {}): LegacyAdvertRow => ({
  legacy_key: "A0",
  wp_member_id: 991,
  name: "Prima Power banner",
  format: "banner",
  desktop_path: "adverts/prima-power/a0-desktop.png",
  mobile_path: "adverts/prima-power/a0-mobile.png",
  link_url: "https://www.primapower.com/en",
  starts_on: "2023-08-24",
  ends_on: "2027-10-31",
  ...over,
});

const opts = (over: Partial<Parameters<typeof planLegacyAdverts>[1]> = {}) => ({
  today: "2026-09-27",
  now: "2026-09-27T12:00:00.000Z",
  memberId: (wp: number) => (wp === 991 || wp === 31448 ? `uuid-${wp}` : null),
  existingDesktopPaths: new Set<string>(),
  ...over,
});

describe("planLegacyAdverts", () => {
  it("gives an in-date run a booking awaiting Jas's approval — never live", () => {
    const { inserts } = planLegacyAdverts([row()], opts());
    expect(inserts).toHaveLength(1);
    expect(inserts[0].booking).toMatchObject({ status: "awaiting_approval", starts_on: "2023-08-24", ends_on: "2027-10-31" });
    expect(inserts[0].advert.member_id).toBe("uuid-991");
  });

  it("imports a lapsed run's artwork with no booking, rather than inventing one", () => {
    const lapsed = row({ legacy_key: "A4", wp_member_id: 31448, desktop_path: "adverts/hpc-laser/a4-desktop.png", ends_on: "2026-09-02" });
    const { inserts } = planLegacyAdverts([lapsed], opts());
    expect(inserts).toHaveLength(1);
    expect(inserts[0].booking).toBeNull();
  });

  it("treats a run ending today as still in date", () => {
    const { inserts } = planLegacyAdverts([row({ ends_on: "2026-09-27" })], opts());
    expect(inserts[0].booking).not.toBeNull();
  });

  it("never links a product — approval would otherwise invoice a run already paid for", () => {
    const { inserts } = planLegacyAdverts([row()], opts());
    expect(inserts[0].booking).not.toHaveProperty("product_id");
    expect(inserts[0].advert).not.toHaveProperty("product_id");
  });

  it("skips what is already on the target, so a re-run inserts nothing", () => {
    const plan = planLegacyAdverts([row()], opts({ existingDesktopPaths: new Set([row().desktop_path]) }));
    expect(plan.inserts).toEqual([]);
    expect(plan.present).toEqual(["A0"]);
  });

  it("reports an advert whose member isn't on the target instead of throwing", () => {
    // adverts.member_id is NOT NULL; a local 40-member subset won't hold every advertiser.
    const plan = planLegacyAdverts([row({ legacy_key: "D0", wp_member_id: 6112 })], opts());
    expect(plan.inserts).toEqual([]);
    expect(plan.noMember).toEqual(["D0"]);
  });

  it("keeps a null link_url, which the schema reads as the member's own page", () => {
    const { inserts } = planLegacyAdverts([row({ link_url: null })], opts());
    expect(inserts[0].advert.link_url).toBeNull();
  });
});
