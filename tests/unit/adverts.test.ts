import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AD_PREVIEW_COOKIE, adPreview, advertHref, bookingPhase, dealSlots, liveAdverts, liveAdvertsByFormat,
  pickOne, resolveAdvertTarget, showAdPlaceholders, uniformShuffle, type LiveAdvert,
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

describe("pickOne", () => {
  it("returns undefined for an empty slot", () => {
    expect(pickOne([])).toBeUndefined();
  });

  it("returns the only item when there is one", () => {
    expect(pickOne([1])).toBe(1);
  });

  it("is deterministic for a given PRNG", () => {
    const rand = () => 0; // always the first item
    expect(pickOne([1, 2, 3], rand)).toBe(1);
  });

  it("can land on every item — not always the first", () => {
    const items = ["a", "b", "c"];
    expect(pickOne(items, () => 0)).toBe("a");
    expect(pickOne(items, () => 0.5)).toBe("b");
    expect(pickOne(items, () => 0.99)).toBe("c");
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
});
