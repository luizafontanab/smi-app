import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultVariant, pickView, SITE_VARIANT_KEY, siteVariant, VARIANT_COOKIE } from "@/lib/variant";
import { serviceDb } from "@/lib/db/server";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";
import { resetDbServerMocks } from "../stubs/db-server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetNextHeadersMocks();
  resetDbServerMocks();
});

/** The site-wide default as stored in `settings` (GAPS A8.2); null = no row. */
function siteDefault(value: unknown) {
  const settings = queryBuilder(dbOk(value === null ? null : { value }));
  const from = fromByTable({ settings: () => settings }, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return { from, settings };
}

describe("siteVariant", () => {
  it("defaults to grid with no cookie and no site-wide setting", async () => {
    siteDefault(null);
    expect(await siteVariant()).toBe("grid");
  });

  // A28: the console's choice is what a visitor with no cookie of their own gets.
  // Forge, not grid: grid is also the fallback, so it couldn't prove the row was read.
  it("gives a visitor with no cookie the site-wide default", async () => {
    const { settings } = siteDefault("forge");
    expect(await siteVariant()).toBe("forge");
    expect(settings.eq).toHaveBeenCalledWith("key", SITE_VARIANT_KEY);
  });

  // The admin switcher previews a design without changing it for anyone else.
  it("lets the browser's own cookie win over the site-wide default, both ways", async () => {
    const { from } = siteDefault("grid");
    cookieStore.set(VARIANT_COOKIE, "forge");
    expect(await siteVariant()).toBe("forge");
    // a chosen cookie never needs the settings read
    expect(from).not.toHaveBeenCalled();

    siteDefault("forge");
    cookieStore.set(VARIANT_COOKIE, "grid");
    expect(await siteVariant()).toBe("grid");
  });

  it("treats a retired cookie value as no choice, falling through to the site-wide default", async () => {
    siteDefault("forge");
    cookieStore.set(VARIANT_COOKIE, "live");
    expect(await siteVariant()).toBe("forge");
  });
});

describe("defaultVariant", () => {
  it("ignores a stored value that isn't a design", async () => {
    siteDefault("purple");
    expect(await defaultVariant()).toBe("grid");
  });

  // A settings hiccup must never take the public site down.
  it("falls back to grid when the settings read throws", async () => {
    vi.mocked(serviceDb).mockImplementation(() => { throw new Error("db down"); });
    expect(await defaultVariant()).toBe("grid");
  });
});

describe("pickView", () => {
  it("selects the view module matching the current variant", async () => {
    cookieStore.set(VARIANT_COOKIE, "grid");
    const View = await pickView({ forge: "ForgeHome", grid: "GridHome" });
    expect(View).toBe("GridHome");
  });
});
