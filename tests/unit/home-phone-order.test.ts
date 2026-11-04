import { describe, expect, it, vi } from "vitest";
import { belowFoldSequence, phoneSectionOrder } from "@/app/(public)/home.grid";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/app/(public)/actions", () => ({ subscribeNewsletter: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => null) }));

/** Two banners next to each other is the thing the rhythm exists to prevent. */
const bannersTouch = (seq: string[]) =>
  seq.some((p, i) => p.startsWith("home_") && seq[i + 1]?.startsWith("home_"));

describe("phoneSectionOrder (#33 C9)", () => {
  it("lifts Upcoming events to the front and keeps the rest in configured order", () => {
    expect(phoneSectionOrder(["videos", "member_news", "supplier_logos", "events", "newsletters"]))
      .toEqual(["events", "videos", "member_news", "supplier_logos", "newsletters"]);
  });

  it("leaves the order alone when events aren't showing", () => {
    expect(phoneSectionOrder(["newsletters", "videos"])).toEqual(["newsletters", "videos"]);
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

  // The phone order is derived through the same rule, so moving events up
  // can never leave two banners together — including the case where events
  // was the only section between them on desktop.
  it.each([
    [["videos", "events"]],
    [["events", "videos"]],
    [["videos", "member_news", "supplier_logos", "events", "newsletters"]],
    [["newsletters", "events", "videos"]],
  ] as const)("never lets banners touch on a phone: %j", (sections) => {
    const phone = belowFoldSequence(phoneSectionOrder([...sections]));
    expect(bannersTouch(phone)).toBe(false);
    // same pieces as desktop, just reordered
    expect([...phone].sort()).toEqual([...belowFoldSequence([...sections])].sort());
  });
});
