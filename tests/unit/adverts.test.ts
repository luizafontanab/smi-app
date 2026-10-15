import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AD_PREVIEW_COOKIE, adPreview, advertHref, bannerOccupancy, BANNERS_PER_POSITION, bookingPhase, dealSlots, liveAdverts,
  liveAdvertsByFormat, peakSold, resolveAdvertTarget, showAdPlaceholders, soldOn, uniformShuffle, type LiveAdvert,
  type SpotBooking,
} from "@/lib/adverts";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("adPreview", () => {
  it("is true only when the preview cookie is explicitly 'empty'", async () => {
    expect(await adPreview()).toBe(false);
    cookieStore.set(AD_PREVIEW_COOKIE, "empty");
    expect(await adPreview()).toBe(true);
    cookieStore.set(AD_PREVIEW_COOKIE, "anything-else");
    expect(await adPreview()).toBe(false);
  });
});

describe("showAdPlaceholders", () => {
  it("shows outside production regardless of the cookie", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await showAdPlaceholders()).toBe(true);
  });

  it("in production, only the preview cookie turns them on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await showAdPlaceholders()).toBe(false);
    cookieStore.set(AD_PREVIEW_COOKIE, "empty");
    expect(await showAdPlaceholders()).toBe(true);
  });
});

describe("bookingPhase", () => {
  const today = "2026-06-15";

  it("maps draft/awaiting_approval/review_required/ended directly", () => {
    expect(bookingPhase({ status: "draft", starts_on: today, ends_on: today }, today)).toBe("draft");
    expect(bookingPhase({ status: "awaiting_approval", starts_on: today, ends_on: today }, today)).toBe("awaiting");
    expect(bookingPhase({ status: "review_required", starts_on: today, ends_on: today }, today)).toBe("changes_needed");
    expect(bookingPhase({ status: "ended", starts_on: today, ends_on: today }, today)).toBe("ended");
  });

  it("decides scheduled/live bookings by their term, not the stored status", () => {
    expect(bookingPhase({ status: "scheduled", starts_on: "2026-07-01", ends_on: "2026-07-31" }, today)).toBe("upcoming");
    expect(bookingPhase({ status: "live", starts_on: "2026-05-01", ends_on: "2026-05-31" }, today)).toBe("ended");
    expect(bookingPhase({ status: "scheduled", starts_on: "2026-06-01", ends_on: "2026-06-30" }, today)).toBe("live");
  });
});

describe("liveAdverts / liveAdvertsByFormat", () => {
  const booking = (id: string, format: string, memberSlug: string | null = "acme") => ({
    advert: {
      id, name: `Ad ${id}`, desktop_path: `d/${id}.jpg`, mobile_path: `m/${id}.jpg`, link_url: null, format,
      member: memberSlug ? { id: `${id}-member`, slug: memberSlug } : null,
    },
  });

  it("returns nothing when the preview cookie empties the inventory", async () => {
    cookieStore.set(AD_PREVIEW_COOKIE, "empty");
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk([booking("1", "banner")])) })));

    expect(await liveAdverts("banner")).toEqual([]);
  });

  it("filters to the requested format and maps the advert shape", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([booking("1", "banner"), booking("2", "mpu")])),
    })));

    const banners = await liveAdverts("banner");

    expect(banners).toEqual([{
      advertId: "1", name: "Ad 1", desktopPath: "d/1.jpg", mobilePath: "m/1.jpg", linkUrl: null,
      memberSlug: "acme", memberId: "1-member", format: "banner",
    }]);
  });

  it("maps a house advert with no member to null slug and id", async () => {
    // Not every advert belongs to a member — house ads and third-party
    // placements have no join row, and the mapped shape must carry nulls
    // rather than undefined, which AdSlot keys off.
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([booking("1", "banner", null)])),
    })));

    expect(await liveAdverts("banner")).toEqual([{
      advertId: "1", name: "Ad 1", desktopPath: "d/1.jpg", mobilePath: "m/1.jpg", linkUrl: null,
      memberSlug: null, memberId: null, format: "banner",
    }]);
  });

  it("dedupes an advert booked twice over overlapping dates", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([booking("1", "banner"), booking("1", "banner")])),
    })));

    expect(await liveAdverts("banner")).toHaveLength(1);
  });

  it("never throws on a query error — just logs and returns nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbError("boom")) })));

    expect(await liveAdverts("banner")).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("liveAdvertsByFormat buckets every requested format from one query, defaulting unmatched formats to []", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([booking("1", "banner"), booking("2", "mpu")])),
    })));

    const byFormat = await liveAdvertsByFormat(["banner", "skyscraper"]);

    expect(byFormat.banner).toHaveLength(1);
    expect(byFormat.skyscraper).toEqual([]);
  });

  it("liveAdvertsByFormat returns every bucket empty under the preview cookie", async () => {
    cookieStore.set(AD_PREVIEW_COOKIE, "empty");
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));

    expect(await liveAdvertsByFormat(["banner", "mpu"])).toEqual({ banner: [], mpu: [] });
  });
});

describe("uniformShuffle", () => {
  it("returns a permutation — same elements, same length", () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled = uniformShuffle(items);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.slice().sort()).toEqual(items.slice().sort());
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3];
    const copy = [...items];
    uniformShuffle(items);
    expect(items).toEqual(copy);
  });

  it("is deterministic for a given PRNG", () => {
    const rand = () => 0; // always picks index 0 — a fixed, reproducible shuffle
    expect(uniformShuffle([1, 2, 3, 4], rand)).toEqual(uniformShuffle([1, 2, 3, 4], rand));
  });
});

describe("dealSlots", () => {
  const ad = (id: string): LiveAdvert => ({
    advertId: id, name: id, desktopPath: "", mobilePath: "", linkUrl: null, memberSlug: null, memberId: null,
  });

  it("gives every slot key an entry, even with no adverts to deal", () => {
    const dealt = dealSlots([], ["a", "b"]);
    expect([...dealt.keys()]).toEqual(["a", "b"]);
    expect(dealt.get("a")).toEqual([]);
  });

  it("never gives one slot the same advert twice before every other slot has had a turn", () => {
    const dealt = dealSlots([ad("1"), ad("2")], ["slot-a"], 5);
    const ids = dealt.get("slot-a")!.map((a) => a.advertId);
    // capped at the pool size — round-robin fills to shuffled.length, not perSlot
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("distributes round-robin across slots before repeating within one", () => {
    const dealt = dealSlots([ad("1"), ad("2"), ad("3")], ["a", "b", "c"], 1);
    expect(dealt.get("a")).toHaveLength(1);
    expect(dealt.get("b")).toHaveLength(1);
    expect(dealt.get("c")).toHaveLength(1);
  });

  it("deals BANNERS_PER_POSITION (3) to each position by default", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ad(String(i)));
    const dealt = dealSlots(pool, ["home_1", "home_2", "home_3"]);
    expect(BANNERS_PER_POSITION).toBe(3);
    for (const key of ["home_1", "home_2", "home_3"]) expect(dealt.get(key)).toHaveLength(3);
  });

  // The carousels advance in lockstep (AdCarousel's shared ticker), so frame r
  // of every position is on screen at once. Those must all differ whenever
  // there are at least as many live banners as positions — for any shuffle.
  it("never shows the same banner in two positions at the same moment when n ≥ positions", () => {
    for (let positions = 1; positions <= 5; positions++) {
      const keys = Array.from({ length: positions }, (_, k) => `p${k}`);
      for (let n = positions; n <= 20; n++) {
        const pool = Array.from({ length: n }, (_, i) => ad(String(i)));
        for (let trial = 0; trial < 5; trial++) {
          const dealt = dealSlots(pool, keys);
          const frames = Math.min(BANNERS_PER_POSITION, n);
          for (let r = 0; r < frames; r++) {
            const onScreen = keys.map((k) => dealt.get(k)![r].advertId);
            expect(new Set(onScreen).size, `P=${positions} n=${n} frame ${r}`).toBe(positions);
          }
        }
      }
    }
  });

  it("puts every live banner somewhere on the page when there are no more than 3 per position", () => {
    const keys = ["a", "b", "c"];
    for (let n = 1; n <= keys.length * BANNERS_PER_POSITION; n++) {
      const pool = Array.from({ length: n }, (_, i) => ad(String(i)));
      const dealt = dealSlots(pool, keys);
      const shown = new Set(keys.flatMap((k) => dealt.get(k)!.map((a) => a.advertId)));
      expect(shown.size, `n=${n}`).toBe(n);
    }
  });
});

describe("banner spots: soldOn / peakSold / bannerOccupancy", () => {
  const b = (status: string, starts_on: string, ends_on: string): SpotBooking => ({ status, starts_on, ends_on });

  it("counts only scheduled/live bookings whose term covers the day, edges inclusive", () => {
    const bookings = [
      b("live", "2026-10-01", "2026-10-31"),
      b("scheduled", "2026-10-31", "2026-11-30"), // starts on the last day
      b("awaiting_approval", "2026-10-01", "2026-10-31"), // pending, not sold
      b("draft", "2026-10-01", "2026-10-31"),
      b("ended", "2026-10-01", "2026-10-31"), // ended early: terminal beats dates
      b("live", "2026-09-01", "2026-10-30"), // ended the day before
    ];
    expect(soldOn(bookings, "2026-10-31")).toBe(2);
    expect(soldOn(bookings, "2026-10-30")).toBe(2);
    expect(soldOn(bookings, "2026-12-01")).toBe(0);
  });

  it("finds the busiest day in a range, first one on a tie, null when nothing is sold", () => {
    const bookings = [b("live", "2026-10-05", "2026-10-10"), b("live", "2026-10-08", "2026-10-20")];
    expect(peakSold(bookings, "2026-10-01", "2026-10-31")).toEqual({ count: 2, day: "2026-10-08" });
    expect(peakSold(bookings, "2026-10-21", "2026-10-31")).toEqual({ count: 0, day: null });
  });

  it("reports six months from today, the current month only from today onward", () => {
    const bookings = [
      b("live", "2026-10-01", "2026-10-03"), // before today: must not count for October
      b("scheduled", "2026-11-15", "2027-01-10"),
      b("scheduled", "2026-12-01", "2026-12-31"),
      b("awaiting_approval", "2026-12-20", "2027-02-01"),
    ];
    const months = bannerOccupancy(bookings, "2026-10-04");
    expect(months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(months[0].peak).toEqual({ count: 0, day: null });
    expect(months[1].peak).toEqual({ count: 1, day: "2026-11-15" });
    expect(months[2].peak).toEqual({ count: 2, day: "2026-12-01" });
    expect(months.map((m) => m.pending)).toEqual([0, 0, 1, 1, 1, 0]);
  });

  // 6 Oct: a run held for payment isn't sold (it isn't on the site), but it
  // is spoken for — it sits with the pending count, never with sold.
  it("counts a run held for payment as pending, not sold", () => {
    const bookings = [b("awaiting_payment", "2026-10-10", "2026-10-20")];
    expect(soldOn(bookings, "2026-10-15")).toBe(0);
    expect(bannerOccupancy(bookings, "2026-10-04", 1)[0].pending).toBe(1);
    expect(bookingPhase(bookings[0], "2026-10-15")).toBe("awaiting_payment");
  });

  it("crosses a year end and handles February", () => {
    const months = bannerOccupancy([b("live", "2027-02-28", "2027-02-28")], "2026-12-31", 3);
    expect(months.map((m) => m.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(months[2].peak).toEqual({ count: 1, day: "2027-02-28" });
  });
});

describe("advertHref / resolveAdvertTarget", () => {
  it("always routes clicks through /visit/:id", () => {
    expect(advertHref({ advertId: "ad1" } as LiveAdvert)).toBe("/visit/ad1");
  });

  it("prefers an explicit link, falls back to the member page, then home", () => {
    expect(resolveAdvertTarget("https://example.com", "acme")).toBe("https://example.com");
    expect(resolveAdvertTarget(null, "acme")).toBe("/member/acme");
    expect(resolveAdvertTarget(null, null)).toBe("/");
  });

  it("adds https:// to a scheme-less link saved before the console validated it", () => {
    // As stored, "www.acme.co.uk" is a relative redirect: /visit/www.acme.co.uk.
    expect(resolveAdvertTarget("www.acme.co.uk", "acme")).toBe("https://www.acme.co.uk");
    expect(resolveAdvertTarget("  acme.co.uk/offers  ", null)).toBe("https://acme.co.uk/offers");
    expect(resolveAdvertTarget("http://acme.co.uk", "acme")).toBe("http://acme.co.uk");
  });

  it("treats a link that can't be a web address as no link — member page, else home", () => {
    for (const junk of ["javascript:alert(1)", "data:text/html,<script>x</script>", "mailto:sales@acme.co.uk", "/member/someone-else", "see website", ""]) {
      expect(resolveAdvertTarget(junk, "acme"), junk).toBe("/member/acme");
      expect(resolveAdvertTarget(junk, null), junk).toBe("/");
    }
  });
});
