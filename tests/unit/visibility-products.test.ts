import { describe, expect, it } from "vitest";
import { VISIBILITY_PRODUCTS, visibilityProductName } from "@/lib/visibility-products";

/**
 * The visibility products a member can request. Previously 0%.
 *
 * The list is shared by the advertising hub's Information, Buy and Manage
 * pages, and `visibility_requests.product` stores the *key* as free text — so a
 * renamed or duplicated key silently orphans every request already recorded
 * against the old one. These assertions are about that contract, not about the
 * marketing copy.
 */
describe("VISIBILITY_PRODUCTS", () => {
  it("has unique keys — a duplicate would make the name lookup order-dependent", () => {
    const keys = VISIBILITY_PRODUCTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every product a name and a detail line", () => {
    for (const p of VISIBILITY_PRODUCTS) {
      expect(p.name.trim(), p.key).not.toBe("");
      expect(p.detail.trim(), p.key).not.toBe("");
    }
  });

  it("keys are snake_case, matching what is written to visibility_requests.product", () => {
    for (const p of VISIBILITY_PRODUCTS) {
      expect(p.key, p.key).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("covers the two placement kinds a member can actually buy", () => {
    // placement_kind also has grid_block and takeover, which are admin-placed
    // rather than member-requested — so the overlap is deliberate, not partial.
    const keys = VISIBILITY_PRODUCTS.map((p) => p.key);
    expect(keys).toContain("featured_member");
    expect(keys).toContain("featured_machine");
  });
});

describe("visibilityProductName", () => {
  it("resolves a known key to its display name", () => {
    expect(visibilityProductName("featured_member")).toBe("Featured Member");
    expect(visibilityProductName("newsletter_slot")).toBe("Newsletter advert");
  });

  it("falls back to the raw key so a retired product still renders something", () => {
    // Old rows keep their key forever; showing it beats showing nothing.
    expect(visibilityProductName("retired_product")).toBe("retired_product");
  });

  it("does not match on a partial or differently-cased key", () => {
    expect(visibilityProductName("Featured_Member")).toBe("Featured_Member");
    expect(visibilityProductName("featured")).toBe("featured");
    expect(visibilityProductName("")).toBe("");
  });
});
