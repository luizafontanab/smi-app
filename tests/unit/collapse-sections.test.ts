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

  it("nests h3 sections inside their parent h2's details, not as siblings", () => {
    const out = collapseSections("<h2>Policy</h2><p>Intro.</p><h3>Detail</h3><p>Fine print.</p>");
    expect(out.match(/<details/g)).toHaveLength(2);
    expect(out.match(/<\/details>/g)).toHaveLength(2);
    expect(out).toContain(">Policy</summary>");
    expect(out).toContain(">Detail</summary>");
    // "Detail" opens (and closes) before the outer "Policy" section closes —
    // it's nested inside, not a sibling that comes after.
    expect(out.indexOf(">Detail</summary>")).toBeGreaterThan(out.indexOf(">Policy</summary>"));
    expect(out.lastIndexOf("</details>")).toBe(out.length - "</details>".length);
    expect(out.indexOf("</details>")).toBeLessThan(out.lastIndexOf("</details>"));
    expect(out.indexOf(">Detail</summary>")).toBeLessThan(out.indexOf("</details>"));
  });

  it("handles an h2 that opens straight onto an h3, with an empty trailing subsection", () => {
    // Three edges at once: no lead paragraph before the first h3, a first h3
    // bounded by the next one rather than by the end of the section, and a
    // final h3 with nothing under it.
    const out = collapseSections("<h2>Policy</h2><h3>One</h3><p>x</p><h3>Two</h3>");
    expect(out.match(/<details/g)).toHaveLength(3);
    // No stray empty content wrapper where the lead paragraph would have been.
    expect(out).toContain(">Policy</summary><details");
    expect(out).toContain(">Two</summary></details>");
  });

  it("keeps a flat page (no h3s) collapsing exactly as single-level sections — FAQ's shape", () => {
    const out = collapseSections("<h2>One</h2><p>A.</p><h2>Two</h2><p>B.</p>");
    expect(out.match(/<details/g)).toHaveLength(2);
    // no nested-details styling appears when there's nothing to nest
    expect(out).not.toContain("bg-paper");
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
