import { afterEach, describe, expect, it, vi } from "vitest";
import { ADVERT_FORMATS, PHASE_LABELS, RETIRED_SLOT_KEYS, advertFormatOptions } from "@/components/console/advert-formats";
import { bookingPhase } from "@/lib/adverts";
import { resetDbServerMocks } from "../stubs/db-server";

// bookingPhase is pure, but its module builds a service client at import time.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("advertFormatOptions", () => {
  it("never offers banner_narrow to a new record", () => {
    // fix-list 64 / HUMAN-TODO §14.5: the 830×170 size renders nowhere, so
    // nobody may be sold it. The Postgres enum value stays registered — this
    // hide is the whole enforcement, which is why it is asserted.
    expect(ADVERT_FORMATS.map((f) => f.value)).not.toContain("banner_narrow");
    expect(advertFormatOptions().map((f) => f.value)).not.toContain("banner_narrow");
    expect(advertFormatOptions(null).map((f) => f.value)).not.toContain("banner_narrow");
  });

  it("keeps a retired format visible for a record that already holds it", () => {
    // Otherwise the <select> falls back to its first option and saving an
    // unrelated field silently rewrites the row's format.
    const values = advertFormatOptions("banner_narrow").map((f) => f.value);
    expect(values).toContain("banner_narrow");
    expect(values[0]).toBe(ADVERT_FORMATS[0].value);
    expect(values).toHaveLength(ADVERT_FORMATS.length + 1);
  });

  it("does not duplicate a format the picker already offers", () => {
    expect(advertFormatOptions("mpu")).toEqual(ADVERT_FORMATS);
  });
});

describe("RETIRED_SLOT_KEYS", () => {
  it("hides home_2_narrow from the capacity grid", () => {
    // The grid it filters moved from the bookings index to the inventory page
    // (fix-list 74). It is a plain .filter() on the page, so nothing else stops
    // a retired position reappearing as an editable number — hence this.
    expect(RETIRED_SLOT_KEYS.has("home_2_narrow")).toBe(true);
    expect(RETIRED_SLOT_KEYS.has("home_1")).toBe(false);
    expect(RETIRED_SLOT_KEYS.has("home_2")).toBe(false);
  });

  it("names slots, not formats — the two vocabularies are separate", () => {
    // banner_narrow is the *format* twin of this hide; a key landing in the
    // wrong set silently un-hides one and over-hides the other.
    expect(RETIRED_SLOT_KEYS.has("banner_narrow")).toBe(false);
  });
});

describe("PHASE_LABELS", () => {
  it("has a label for every phase bookingPhase can return", () => {
    const cases = [
      { status: "draft", starts_on: "2026-01-01", ends_on: "2026-12-31" },
      { status: "awaiting_approval", starts_on: "2026-01-01", ends_on: "2026-12-31" },
      { status: "review_required", starts_on: "2026-01-01", ends_on: "2026-12-31" },
      { status: "ended", starts_on: "2026-01-01", ends_on: "2026-12-31" },
      { status: "scheduled", starts_on: "2026-07-01", ends_on: "2026-07-31" }, // upcoming
      { status: "live", starts_on: "2026-01-01", ends_on: "2026-12-31" }, // live
      { status: "live", starts_on: "2025-01-01", ends_on: "2025-12-31" }, // ended by term
    ];
    const today = "2026-06-15";
    const phases = new Set(cases.map((c) => bookingPhase(c, today)));
    expect(phases.size).toBe(6);
    for (const phase of phases) expect(PHASE_LABELS[phase]).toBeTruthy();
  });
});
