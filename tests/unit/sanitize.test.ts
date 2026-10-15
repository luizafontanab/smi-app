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

// Jas 13/10 item 19: image position + size, admitted only from the closed lists.
describe("sanitizeRichText — image layout", () => {
  const img = (attrs: string) => `<img src="${MEDIA}/stories/x.jpg" alt="" ${attrs} />`;

  it("keeps an allowed alignment and size", () => {
    const out = sanitizeRichText(img(`data-align="left" data-size="small"`));
    expect(out).toContain(`data-align="left"`);
    expect(out).toContain(`data-size="small"`);
  });

  it("removes an unknown value outright rather than leaving an empty attribute", () => {
    const out = sanitizeRichText(img(`data-align="center" data-size="huge"`));
    expect(out).not.toContain("data-align");
    expect(out).not.toContain("data-size");
    expect(out).toContain(`src="${MEDIA}/stories/x.jpg"`);
  });

  it("still drops every other data-* and style on an image", () => {
    const out = sanitizeRichText(img(`data-x="1" style="float:left" class="alignleft"`));
    expect(out).not.toMatch(/data-x|style|class/);
  });

  it("is idempotent, and still refuses images from anywhere but our bucket", () => {
    const once = sanitizeRichText(img(`data-align="right" data-size="large"`));
    expect(sanitizeRichText(once)).toBe(once);
    expect(sanitizeRichText(`<img src="https://evil.example/x.jpg" data-align="left" />`)).toBe("");
  });

  it("survives the split at advert breaks", () => {
    const [first] = splitAtAdBreaks(`${img(`data-align="left" data-size="medium"`)}<p>a</p>${BREAK}<p>b</p>`);
    expect(first).toContain(`data-align="left"`);
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

  it("sanitises a legacy row with a real tag typed partway through, not just at the start", () => {
    // A row written before the rich-text editor existed can be mostly plain
    // text with one inline tag typed by hand — the leading-`<` heuristic used
    // to miss this and escape the tag into visible "&lt;strong&gt;" text.
    expect(renderableHtml("Founded in 1990, <strong>we</strong> specialise in laser cutting.")).toBe(
      "Founded in 1990, <strong>we</strong> specialise in laser cutting.",
    );
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

  it("can yield a segment opening on bare text, with a real tag later in it", () => {
    // Imported bodies are full of bare top-level text where the sanitiser stripped
    // a <figure> or <h4>, so a break can legitimately land in front of one.
    const [, second] = splitAtAdBreaks(`<p>a</p>${BREAK}Caption<p>b</p>`);
    expect(sanitizeRichText(second)).toBe("Caption<p>b</p>");
    // renderableHtml recognises the real <p> tag later in the string and
    // sanitises rather than escapes — a segment like this is exactly the shape
    // that used to publish visible "&lt;p&gt;" markup before the tag-anywhere fix.
    expect(renderableHtml(second)).toBe("Caption<p>b</p>");
  });

  it("still differs from sanitizeRichText for a segment with no tag anywhere — why StoryBody sanitises, not renders", () => {
    // A segment that's pure bare text (no recognisable tag at all) still gets
    // paragraph-wrapped by renderableHtml, changing its structure — this is the
    // remaining reason StoryBody.tsx must call sanitizeRichText directly.
    const [, second] = splitAtAdBreaks(`<p>a</p>${BREAK}Caption`);
    expect(sanitizeRichText(second)).toBe("Caption");
    expect(renderableHtml(second)).toBe("<p>Caption</p>");
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

  it("replaces an entity it does not know with a space rather than leaving it raw", () => {
    // The table only covers what the WordPress import actually emitted. An
    // unknown entity must not leak "&euro;" into a card summary.
    expect(excerptFromHtml("<p>Costs &euro;500 a year</p>")).toBe("Costs 500 a year");
  });

  it("cuts mid-word when the limit falls before the first space", () => {
    // A long unbroken token (a URL, a part number) has no word boundary to cut
    // on — better a hard cut than returning the whole 10k-char body.
    expect(excerptFromHtml(`<p>${"a".repeat(30)}</p>`, 12)).toBe(`${"a".repeat(12)}…`);
  });

  it("returns null for markup with no text", () => {
    expect(excerptFromHtml(`<img src="x" />`)).toBeNull();
    expect(excerptFromHtml(null)).toBeNull();
    expect(excerptFromHtml("")).toBeNull();
  });
});
