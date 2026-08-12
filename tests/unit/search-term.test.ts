import { describe, expect, it } from "vitest";
import { ilikeTerm } from "@/lib/queries";

// The directory search interpolates the term into a PostgREST `or=(…)` filter. That
// string is a comma/paren-delimited logic tree, so an unsanitised term can append its
// own match-everything leaf and return the whole member list. These cases were each
// verified against the local PostgREST before being pinned here.
describe("ilikeTerm — a search term can never widen the PostgREST or=() filter", () => {
  it("neutralises the logic-tree delimiters", () => {
    expect(ilikeTerm("zzzz,id.not.is.null")).toBe("zzzz id.not.is.null");
    expect(ilikeTerm("a)b")).toBe("a b");
    expect(ilikeTerm("a(b")).toBe("a b");
  });

  it("neutralises LIKE wildcards so the term stays a literal substring", () => {
    expect(ilikeTerm("100%")).toBe("100");
    expect(ilikeTerm("a_b")).toBe("a b");
    expect(ilikeTerm("a*b")).toBe("a b");
  });

  it("strips backslashes — LIKE's escape char would eat our closing wildcard", () => {
    expect(ilikeTerm("acme\\")).toBe("acme");
  });

  it("strips double quotes — an unterminated quote is a PostgREST value delimiter", () => {
    expect(ilikeTerm('"acme')).toBe("acme");
  });

  it("keeps the punctuation real member names use", () => {
    expect(ilikeTerm("O'Brien & Sons Ltd.")).toBe("O'Brien & Sons Ltd.");
    expect(ilikeTerm("co.uk")).toBe("co.uk");
    expect(ilikeTerm("A+B")).toBe("A+B");
  });

  it("collapses whitespace, trims, and caps the length", () => {
    expect(ilikeTerm("  a   b  ")).toBe("a b");
    expect(ilikeTerm("x".repeat(500))).toHaveLength(80);
  });

  it("returns empty for whitespace-only and wildcard-only input", () => {
    expect(ilikeTerm("   ")).toBe("");
    expect(ilikeTerm("%%%")).toBe("");
  });
});
