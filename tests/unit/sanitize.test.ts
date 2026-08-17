import { beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:56321";
const MEDIA = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media`;

let sanitizeRichText: (html: string) => string;
let richTextFromPlain: (text: string) => string;
let renderableHtml: (text: string | null | undefined) => string;
let excerptFromHtml: (html: string | null | undefined, max?: number) => string | null;
let splitAtAdBreaks: (text: string | null | undefined, max?: number) => string[];
let MAX_AD_BREAKS: number;

/** The marker exactly as the editor emits it. */
const BREAK = `<hr data-ad-break="">`;

beforeAll(async () => {
  ({ sanitizeRichText, richTextFromPlain, renderableHtml, excerptFromHtml, splitAtAdBreaks, MAX_AD_BREAKS } =
    await import("@/lib/sanitize"));
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

  it("keeps the advert break so it survives the write path", () => {
    expect(sanitizeRichText(`<p>a</p>${BREAK}<p>b</p>`)).toContain("data-ad-break");
  });

  it("drops a bare <hr> and any settings on the break — rotation decides what shows", () => {
    expect(sanitizeRichText("<p>a</p><hr /><p>b</p>")).toBe("<p>a</p><p>b</p>");
    expect(sanitizeRichText(`<hr data-ad-break="" data-advertiser="acme" />`)).not.toContain("acme");
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

  it("strips advert breaks — they only mean anything in a split story body", () => {
    expect(renderableHtml(`<p>a</p>${BREAK}<p>b</p>`)).toBe("<p>a</p><p>b</p>");
  });
});

describe("splitAtAdBreaks", () => {
  it("returns one segment when there is no break", () => {
    expect(splitAtAdBreaks("<p>a</p><p>b</p>")).toEqual(["<p>a</p><p>b</p>"]);
  });

  it("splits the body at the marker and consumes it", () => {
    expect(splitAtAdBreaks(`<p>a</p>${BREAK}<p>b</p>`)).toEqual(["<p>a</p>", "<p>b</p>"]);
  });

  it("drops a leading break — no page may open with an advert", () => {
    expect(splitAtAdBreaks(`${BREAK}<p>a</p>`)).toEqual(["<p>a</p>"]);
  });

  it("drops a trailing break — the layout already ends with a footer advert", () => {
    expect(splitAtAdBreaks(`<p>a</p>${BREAK}`)).toEqual(["<p>a</p>"]);
  });

  it("collapses adjacent breaks into one", () => {
    expect(splitAtAdBreaks(`<p>a</p>${BREAK}${BREAK}<p>b</p>`)).toEqual(["<p>a</p>", "<p>b</p>"]);
  });

  it("honours at most MAX_AD_BREAKS, folding the surplus into the tail", () => {
    const body = ["<p>1</p>", "<p>2</p>", "<p>3</p>", "<p>4</p>"].join(BREAK);
    const out = splitAtAdBreaks(body);
    expect(MAX_AD_BREAKS).toBe(2);
    expect(out).toEqual(["<p>1</p>", "<p>2</p>", "<p>3</p><p>4</p>"]);
    expect(out.length - 1).toBe(MAX_AD_BREAKS);
  });

  it("ignores a bare <hr> — imported rules must not become ad inventory", () => {
    expect(splitAtAdBreaks("<p>a</p><hr /><p>b</p>")).toEqual(["<p>a</p><p>b</p>"]);
  });

  it("still paragraph-wraps legacy plain text", () => {
    expect(splitAtAdBreaks("plain words")).toEqual(["<p>plain words</p>"]);
  });

  it("returns no segments for null/empty", () => {
    expect(splitAtAdBreaks(null)).toEqual([]);
    expect(splitAtAdBreaks("")).toEqual([]);
  });

  it("can yield a segment opening on bare text — why StoryBody sanitises, not renders", () => {
    // Imported bodies are full of bare top-level text where the sanitiser stripped
    // a <figure> or <h4>, so a break can legitimately land in front of one.
    const [, second] = splitAtAdBreaks(`<p>a</p>${BREAK}Caption<p>b</p>`);
    expect(sanitizeRichText(second)).toBe("Caption<p>b</p>");
    // renderableHtml paragraph-wraps it instead, publishing visible escaped markup
    expect(renderableHtml(second)).toContain("&lt;p&gt;");
  });

  it("re-sanitising repairs a break that splits a blockquote", () => {
    const segments = splitAtAdBreaks(`<blockquote><p>a</p>${BREAK}<p>b</p></blockquote>`);
    expect(segments.map((s) => sanitizeRichText(s))).toEqual(["<blockquote><p>a</p></blockquote>", "<p>b</p>"]);
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
