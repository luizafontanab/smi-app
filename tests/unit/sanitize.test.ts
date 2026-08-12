import { beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:56321";
const MEDIA = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media`;

let sanitizeRichText: (html: string) => string;
let richTextFromPlain: (text: string) => string;
let renderableHtml: (text: string | null | undefined) => string;
let excerptFromHtml: (html: string | null | undefined, max?: number) => string | null;

beforeAll(async () => {
  ({ sanitizeRichText, richTextFromPlain, renderableHtml, excerptFromHtml } = await import("@/lib/sanitize"));
});

describe("sanitizeRichText", () => {
  it("keeps the .story-body vocabulary", () => {
    const html = `<p>Hi <strong>bold</strong> <em>it</em></p><h2>Head</h2><ul><li>one</li></ul><blockquote><p>q</p></blockquote>`;
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("strips script tags and their content", () => {
    expect(sanitizeRichText(`<p>ok</p><script>alert(1)</script>`)).toBe("<p>ok</p>");
  });

  it("strips event handlers and style attributes", () => {
    expect(sanitizeRichText(`<p onclick="x()" style="color:red">hi</p>`)).toBe("<p>hi</p>");
  });

  it("drops javascript: links but keeps text", () => {
    const out = sanitizeRichText(`<a href="javascript:alert(1)">click</a>`);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("forces rel on links", () => {
    expect(sanitizeRichText(`<a href="https://x.com">x</a>`)).toBe(`<a href="https://x.com" rel="noopener nofollow">x</a>`);
  });

  it("removes iframes entirely", () => {
    expect(sanitizeRichText(`<p>a</p><iframe src="https://evil.example"></iframe>`)).toBe("<p>a</p>");
  });

  it("allows images only from the media bucket", () => {
    const ours = `<img src="${MEDIA}/stories/x.jpg" alt="" />`;
    expect(sanitizeRichText(ours)).toContain(`src="${MEDIA}/stories/x.jpg"`);
    expect(sanitizeRichText(`<img src="https://evil.example/x.jpg" />`)).toBe("");
    expect(sanitizeRichText(`<img src="x" onerror="alert(1)" />`)).toBe("");
  });

  it("is idempotent", () => {
    const once = sanitizeRichText(`<p>hey <b>x</b> <strong>y</strong></p>`);
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("richTextFromPlain", () => {
  it("wraps blank-line paragraphs and escapes markup", () => {
    expect(richTextFromPlain("one <b>\n\ntwo & three")).toBe("<p>one &lt;b&gt;</p><p>two &amp; three</p>");
  });

  it("turns single newlines into <br />", () => {
    expect(richTextFromPlain("a\nb")).toBe("<p>a<br />b</p>");
  });
});

describe("renderableHtml", () => {
  it("sanitises html-looking input", () => {
    expect(renderableHtml(`<p>x</p><script>y</script>`)).toBe("<p>x</p>");
  });

  it("paragraph-wraps plain text", () => {
    expect(renderableHtml("plain words")).toBe("<p>plain words</p>");
  });

  it("handles null/empty", () => {
    expect(renderableHtml(null)).toBe("");
    expect(renderableHtml("")).toBe("");
  });
});

describe("excerptFromHtml", () => {
  it("strips tags, decodes entities and collapses whitespace", () => {
    const html = `<h2 class="wp-block-heading"><strong>Tee-rific</strong></h2>\r\n\r\nWe&#8217;d be delighted&nbsp;&amp; more`;
    expect(excerptFromHtml(html)).toBe("Tee-rific We’d be delighted & more");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    expect(excerptFromHtml("<p>one two three four five</p>", 12)).toBe("one two…");
  });

  it("leaves text at or under the limit alone", () => {
    expect(excerptFromHtml("<p>short</p>", 20)).toBe("short");
  });

  it("returns null for markup with no text", () => {
    expect(excerptFromHtml(`<img src="x" />`)).toBeNull();
    expect(excerptFromHtml(null)).toBeNull();
    expect(excerptFromHtml("")).toBeNull();
  });
});
