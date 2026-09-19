import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATE_BYTES,
  collapseBlankLines,
  dropEmptyParagraphs,
  interpolate,
  tokensIn,
  validateTemplate,
} from "@/lib/email/render";

/**
 * These are the rules that make admin-authored email templates safe: an admin
 * writes the markup, but never supplies the values, and a member's own words
 * never become markup.
 */

describe("interpolate", () => {
  it("substitutes a known token", () => {
    expect(interpolate("Ends {{ends_on}}.", { ends_on: "Friday" })).toBe("Ends Friday.");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolate("Ends {{ ends_on }}.", { ends_on: "Friday" })).toBe("Ends Friday.");
  });

  it("leaves an unknown token verbatim rather than blanking it", () => {
    // A typo that deletes itself is a typo nobody can find. Left in place, it
    // shows up in the preview as literal braces.
    expect(interpolate("Ends {{ends_onn}}.", { ends_on: "Friday" })).toBe("Ends {{ends_onn}}.");
  });

  it("substitutes an empty value without leaving the braces behind", () => {
    expect(interpolate("payment{{amount_phrase}}.", { amount_phrase: "" })).toBe("payment.");
  });

  it("does not rescan its own output", () => {
    // Otherwise a member whose reason reads "{{base}}" could reach another token.
    expect(interpolate("{{reason}}", { reason: "{{base}}", base: "https://smi.test" })).toBe("{{base}}");
  });

  it("escapes values into HTML but not into text", () => {
    const vars = { reason: '<b>"hi"</b> & co' };
    expect(interpolate("<p>{{reason}}</p>", vars, { escape: true })).toBe(
      "<p>&lt;b&gt;&quot;hi&quot;&lt;/b&gt; &amp; co</p>",
    );
    expect(interpolate("{{reason}}", vars)).toBe('<b>"hi"</b> & co');
  });

  it("leaves an allow-listed raw token unescaped", () => {
    const out = interpolate("<div>{{body}}{{reason}}</div>", { body: "<p>hi</p>", reason: "<b>x</b>" }, {
      escape: true,
      raw: ["body"],
    });
    expect(out).toBe("<div><p>hi</p>&lt;b&gt;x&lt;/b&gt;</div>");
  });

  it("leaves Resend's triple-brace unsubscribe token intact", () => {
    // A naive /\{\{(\w+)\}\}/ eats the INNER two braces of {{{X}}}, leaving a
    // stray brace and a dead unsubscribe link. That is a PECR problem.
    const source = '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>';
    expect(interpolate(source, { RESEND_UNSUBSCRIBE_URL: "https://wrong.test" })).toBe(source);
    expect(tokensIn(source)).toEqual([]);
  });
});

describe("empty-content cleanup", () => {
  it("drops a paragraph whose only content interpolated away", () => {
    const html = dropEmptyParagraphs('<p style="margin:0">one</p><p style="margin:0"></p>');
    expect(html).toBe('<p style="margin:0">one</p>');
  });

  it("keeps a paragraph that still has content", () => {
    expect(dropEmptyParagraphs("<p>one</p><p>two</p>")).toBe("<p>one</p><p>two</p>");
  });

  it("collapses the blank line an absent sentence leaves in the text variant", () => {
    expect(collapseBlankLines("one\n\n\n\ntwo\n\n")).toBe("one\n\ntwo");
  });
});

describe("validateTemplate", () => {
  const allowed = ["reason", "body"];

  it("accepts a template using only its own tokens", () => {
    expect(validateTemplate({ allowed, fields: { body: "<p>{{reason}}</p>" } })).toBeNull();
  });

  it("names the token that doesn't exist", () => {
    const error = validateTemplate({ allowed, fields: { "HTML body": "<p>{{raeson}}</p>" } });
    expect(error).toContain("{{raeson}}");
    expect(error).toContain("HTML body");
  });

  it("refuses a template that drops a token it cannot work without", () => {
    const error = validateTemplate({ allowed, required: ["body"], fields: { shell: "<html></html>" } });
    expect(error).toContain("{{body}}");
  });

  it("accepts a required token supplied in any field", () => {
    expect(validateTemplate({ allowed, required: ["body"], fields: { a: "<html>", b: "{{body}}" } })).toBeNull();
  });

  it("refuses a template large enough for Gmail to clip", () => {
    const error = validateTemplate({ allowed, fields: { body: "x".repeat(MAX_TEMPLATE_BYTES + 1) } });
    expect(error).toContain("too long");
  });

  it("skips fields left blank, which fall through to the default", () => {
    expect(validateTemplate({ allowed, fields: { body: null, subject: "" } })).toBeNull();
  });
});
