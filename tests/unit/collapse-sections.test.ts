import { describe, expect, it } from "vitest";
import { collapseSections } from "@/lib/collapse-sections";

describe("collapseSections", () => {
  it("returns HTML without headings unchanged", () => {
    const html = "<p>Just a paragraph.</p><ul><li>and a list</li></ul>";
    expect(collapseSections(html)).toBe(html);
    expect(collapseSections("")).toBe("");
  });

  it("splits h2 sections into details blocks, keeping the preamble as-is", () => {
    const html =
      "<p>Preamble stays put.</p>" +
      "<h2>First</h2><p>Alpha.</p>" +
      "<h2>Second</h2><p>Beta.</p><p>Gamma.</p>";
    const out = collapseSections(html);

    expect(out.startsWith("<p>Preamble stays put.</p><details")).toBe(true);
    expect(out.match(/<details/g)).toHaveLength(2);
    expect(out).toContain("<summary");
    expect(out).toContain(">First</summary>");
    expect(out).toContain(">Second</summary>");
    // section content preserved verbatim inside its wrapper
    expect(out).toContain("<p>Alpha.</p></div></details>");
    expect(out).toContain("<p>Beta.</p><p>Gamma.</p></div></details>");
    // no stray heading tags survive
    expect(out).not.toContain("<h2>");
  });

  it("preserves inline HTML inside headings and sections", () => {
    const out = collapseSections("<h2>About <strong>SMI</strong></h2><p>Body with <em>emphasis</em>.</p>");
    expect(out).toContain("<summary");
    expect(out).toContain("About <strong>SMI</strong></summary>");
    expect(out).toContain("<p>Body with <em>emphasis</em>.</p>");
  });

  it("treats h3s as flat top-level sections — no nesting inside an h2 section", () => {
    // Documented choice: every h2 OR h3 starts a new section, so the h3 here
    // ends the h2's card and gets its own rather than nesting inside it.
    const out = collapseSections("<h2>Policy</h2><p>Intro.</p><h3>Detail</h3><p>Fine print.</p>");
    expect(out.match(/<details/g)).toHaveLength(2);
    expect(out.match(/<\/details>/g)).toHaveLength(2);
    expect(out).toContain(">Policy</summary>");
    expect(out).toContain(">Detail</summary>");
    // the h2 section closes before the h3 section opens
    expect(out.indexOf("</details>")).toBeLessThan(out.indexOf(">Detail</summary>"));
  });

  it("emits no empty content wrapper for a heading with nothing under it", () => {
    const out = collapseSections("<h2>Empty</h2><h2>Full</h2><p>x</p>");
    expect(out).toContain(">Empty</summary></details>");
    expect(out).toContain(">Full</summary><div");
  });

  it("does not throw on malformed HTML and leaves unmatched fragments alone", () => {
    expect(() => collapseSections("<h2>Never closed")).not.toThrow();
    expect(collapseSections("<h2>Never closed")).toBe("<h2>Never closed");
    // mismatched close tag is not a heading match
    expect(collapseSections("<h2>Oops</h3><p>x</p>")).toBe("<h2>Oops</h3><p>x</p>");
    // a malformed straggler after a valid section rides along in that section's content
    const out = collapseSections("<h2>Ok</h2><p>fine</p><h3>dangling");
    expect(() => out).not.toThrow();
    expect(out).toContain(">Ok</summary>");
    expect(out).toContain("<h3>dangling");
  });
});
