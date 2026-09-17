import { afterEach, describe, expect, it } from "vitest";
import { pickView, siteVariant, VARIANT_COOKIE } from "@/lib/variant";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";

afterEach(resetNextHeadersMocks);

describe("siteVariant", () => {
  it("defaults to forge with no cookie set", async () => {
    expect(await siteVariant()).toBe("forge");
  });

  it("reads grid from the cookie", async () => {
    cookieStore.set(VARIANT_COOKIE, "grid");
    expect(await siteVariant()).toBe("grid");
  });

  it("treats any other value (a retired cookie) as forge", async () => {
    cookieStore.set(VARIANT_COOKIE, "live");
    expect(await siteVariant()).toBe("forge");
  });
});

describe("pickView", () => {
  it("selects the view module matching the current variant", async () => {
    cookieStore.set(VARIANT_COOKIE, "grid");
    const View = await pickView({ forge: "ForgeHome", grid: "GridHome" });
    expect(View).toBe("GridHome");
  });
});
