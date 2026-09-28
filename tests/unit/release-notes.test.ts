import { describe, expect, it } from "vitest";
import { loadReleaseNotes, parseReleaseNotes } from "@/lib/release-notes";

describe("parseReleaseNotes", () => {
  it("reads headings and bullets in file order", () => {
    const md = [
      "## 2026-09-27 — Second",
      "- b1",
      "- b2",
      "",
      "## 2026-09-20 - First",
      "- a1",
    ].join("\n");
    expect(parseReleaseNotes(md)).toEqual([
      { date: "2026-09-27", title: "Second", items: ["b1", "b2"] },
      { date: "2026-09-20", title: "First", items: ["a1"] },
    ]);
  });

  it("ignores blank lines and multi-line comments", () => {
    const md = "<!--\n  ## not a heading\n  - not a bullet\n-->\n\n## 2026-01-02 — Only\n\n- x\n";
    expect(parseReleaseNotes(md)).toEqual([{ date: "2026-01-02", title: "Only", items: ["x"] }]);
  });

  it("returns an empty list for an empty file", () => {
    expect(parseReleaseNotes("")).toEqual([]);
  });

  it("rejects a date that is shaped right but does not exist", () => {
    expect(() => parseReleaseNotes("## 2026-02-30 — Nope")).toThrow(/not a real date/);
  });

  it("rejects a heading without a date", () => {
    expect(() => parseReleaseNotes("## Big release")).toThrow(/line 1/);
  });

  it("rejects a bullet before any heading", () => {
    expect(() => parseReleaseNotes("- orphan")).toThrow(/needs a/);
  });

  it("rejects prose outside the subset", () => {
    expect(() => parseReleaseNotes("## 2026-01-02 — Ok\nSome paragraph")).toThrow(/line 2/);
  });
});

describe("the shipped release notes file", () => {
  // A malformed edit to src/content/release-notes.md fails here, not on the page.
  it("parses, is newest first, and every release lists at least one change", () => {
    const notes = loadReleaseNotes();
    expect(notes.length).toBeGreaterThan(0);
    const dates = notes.map((n) => n.date);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const n of notes) expect(n.items.length).toBeGreaterThan(0);
  });
});
