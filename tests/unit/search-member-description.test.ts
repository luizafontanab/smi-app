import { describe, expect, it } from "vitest";
import { excerptFromHtml } from "@/lib/sanitize";

/*
 * #33 C2: /search printed member descriptions raw — "<p>Welcome to the future
 * of your business.</p>", "<p>Axe &amp; Status - …". The page now runs them
 * through excerptFromHtml; these are the shapes the audit found.
 */
describe("member descriptions on /search", () => {
  it("drops the paragraph tags", () => {
    expect(excerptFromHtml("<p>Welcome to the future of your business.</p>", 160)).toBe("Welcome to the future of your business.");
  });

  it("decodes the ampersand rather than showing the entity", () => {
    expect(excerptFromHtml("<p>Axe &amp; Status - Working in partnership</p>", 160)).toBe("Axe & Status - Working in partnership");
  });

  it("keeps a long description to a card-sized excerpt", () => {
    const out = excerptFromHtml(`<p>${"word ".repeat(80)}</p>`, 160)!;
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith("…")).toBe(true);
  });
});
