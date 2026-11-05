import { describe, expect, it, vi } from "vitest";
import { bannersTouch, belowFoldSequence, phoneSequence } from "@/app/(public)/home.grid";
import type { HomeSectionId } from "@/lib/home-sections";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/app/(public)/actions", () => ({ subscribeNewsletter: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => null) }));

describe("phoneSequence (#33 C9)", () => {
  it("lifts Upcoming events to the front and leaves every other piece, banners included, where it was", () => {
    const desktop = belowFoldSequence(["videos", "member_news", "supplier_logos", "events", "newsletters"]);
    expect(phoneSequence(desktop))
      .toEqual(["events", "videos", "home_2", "member_news", "supplier_logos", "newsletters", "home_3", "stats"]);
  });

  it("returns the desktop run itself when events aren't showing or already lead", () => {
    for (const sections of [["newsletters", "videos"], ["events", "videos", "newsletters"]] as HomeSectionId[][]) {
      const desktop = belowFoldSequence(sections);
      expect(phoneSequence(desktop)).toBe(desktop);
    }
  });

  // events the only section between the banners: lifting it would join them,
  // so the phone keeps the desktop order (events is already second of two).
  it("doesn't lift events when that would leave home_2 and home_3 touching", () => {
    const desktop = belowFoldSequence(["videos", "events"]);
    expect(bannersTouch(["videos", "home_2", "home_3", "stats"])).toBe(true);
    expect(phoneSequence(desktop)).toBe(desktop);
  });

  it.each([
    [["videos", "events"]],
    [["events", "videos"]],
    [["videos", "member_news", "supplier_logos", "events", "newsletters"]],
    [["newsletters", "events", "videos"]],
    [["videos", "newsletters", "events"]],
    [["events"]],
  ] as const)("never lets banners touch on a phone: %j", (sections) => {
    const desktop = belowFoldSequence([...sections]);
    const phone = phoneSequence(desktop);
    expect(bannersTouch(phone)).toBe(false);
    // same pieces as desktop, just reordered
    expect([...phone].sort()).toEqual([...desktop].sort());
  });
});

describe("belowFoldSequence", () => {
  it("puts home_2 after the first section and home_3 after the last", () => {
    expect(belowFoldSequence(["videos", "events", "newsletters"]))
      .toEqual(["videos", "home_2", "events", "newsletters", "home_3", "stats"]);
  });

  it("drops home_3 below the stats band with a single section", () => {
    expect(belowFoldSequence(["videos"])).toEqual(["videos", "home_2", "stats", "home_3"]);
  });
});
