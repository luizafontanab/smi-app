import { describe, expect, it } from "vitest";
import { bundleGroup, bundleLive, groupBy, pendingReason, placementGroup, runGroup } from "@/lib/booking-groups";

const today = "2026-10-15";
const run = (status: string, starts_on = "2026-10-01", ends_on = "2026-10-31") => ({ status, starts_on, ends_on });

describe("runGroup", () => {
  it("books live and upcoming runs", () => {
    expect(runGroup(run("live"), today)).toBe("booked");
    expect(runGroup(run("scheduled", "2026-11-01", "2026-11-30"), today)).toBe("booked");
  });

  it("puts anything not confirmed in pending — approval, changes, payment, draft", () => {
    for (const status of ["awaiting_approval", "review_required", "awaiting_payment", "draft"]) {
      expect(runGroup(run(status), today), status).toBe("pending");
    }
  });

  it("sends finished and called-off runs to past", () => {
    expect(runGroup(run("ended"), today)).toBe("past");
    expect(runGroup(run("live", "2026-09-01", "2026-09-30"), today)).toBe("past");
  });
});

describe("pendingReason", () => {
  it("says what a pending run is waiting on, and nothing for a booked one", () => {
    expect(pendingReason(run("awaiting_approval"), today)).toBe("needs your approval");
    expect(pendingReason(run("awaiting_payment"), today)).toBe("waiting for payment");
    expect(pendingReason(run("review_required"), today)).toBe("waiting for the member's changes");
    expect(pendingReason(run("live"), today)).toBeNull();
  });
});

describe("placementGroup", () => {
  it("is pending only while held for payment, past once its dates are gone", () => {
    expect(placementGroup({ awaiting_payment: false, ends_on: "2026-10-31" }, today)).toBe("booked");
    expect(placementGroup({ awaiting_payment: true, ends_on: "2026-10-31" }, today)).toBe("pending");
    expect(placementGroup({ awaiting_payment: true, ends_on: "2026-10-01" }, today)).toBe("past");
  });
});

describe("bundleGroup", () => {
  it("is pending with no parts, or with any part still waiting", () => {
    expect(bundleGroup([], today)).toBe("pending");
    expect(bundleGroup([run("live"), run("awaiting_payment")], today)).toBe("pending");
  });

  it("is booked once a part runs and none waits, past when all have ended", () => {
    expect(bundleGroup([run("live"), run("ended")], today)).toBe("booked");
    expect(bundleGroup([run("ended"), run("live", "2026-01-01", "2026-02-01")], today)).toBe("past");
  });
});

// The Bundles page badged a bundle "live" when any part had started — an
// ended part, or one still held for payment, included.
describe("bundleLive", () => {
  it("only when a part is on the site today", () => {
    expect(bundleLive([run("scheduled")], today)).toBe(true);
    expect(bundleLive([run("scheduled", "2026-09-01", "2026-09-30"), run("scheduled", "2026-11-01", "2026-11-30")], today)).toBe(false);
    expect(bundleLive([run("ended", "2026-10-01", "2026-10-31")], today)).toBe(false);
    expect(bundleLive([run("awaiting_payment")], today)).toBe(false);
    expect(bundleLive([], today)).toBe(false);
  });
});

describe("groupBy", () => {
  it("always returns all three groups, empty or not", () => {
    expect(groupBy([run("live")], (r) => runGroup(r, today))).toEqual({ booked: [run("live")], pending: [], past: [] });
  });
});
