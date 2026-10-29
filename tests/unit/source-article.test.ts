import { describe, expect, it } from "vitest";
import { linkFirstMention, nameVariants, parseArticle, withoutSiteName } from "@/lib/sources/article";

const LONG = "This paragraph is long enough to count as real article text, not a caption or a button.";

describe("parseArticle", () => {
  it("reads the og tags and the post body, dropping widgets and the repeated title", () => {
    // Modelled on a Divi/WordPress page: "sidebar" is in the <body> class, which
    // once made the widget filter remove the whole page.
    const html = `<html><head>
      <title>Acme wins award | Acme Ltd</title>
      <meta property="og:title" content="Acme wins award | Acme Ltd">
      <meta property="og:description" content="We won the award.">
      <meta property="og:image" content="/uploads/award.jpg">
    </head><body class="et_right_sidebar">
      <nav><p>${LONG} (menu)</p></nav>
      <article><div class="entry-content">
        <h1>Acme wins award</h1>
        <p class="post-meta">Posted 1 Oct</p>
        <p>${LONG} We are <b>delighted</b>.</p>
        <p>&nbsp;</p>
        <h4>Next steps</h4>
        <p>See <a href="/contact">our team</a> and <a href="javascript:alert(1)">this</a>. ${LONG}</p>
        <img src="https://acme.test/x.jpg">
        <div class="share-buttons"><p>${LONG} (share)</p></div>
      </div></article>
      <aside><p>${LONG} (sidebar)</p></aside>
    </body></html>`;
    const a = parseArticle(html, "https://www.acme.test/news/award/");
    expect(a.title).toBe("Acme wins award");
    expect(a.excerpt).toBe("We won the award.");
    expect(a.imageUrl).toBe("https://www.acme.test/uploads/award.jpg");
    expect(a.bodyHtml).toContain("<strong>delighted</strong>");
    expect(a.bodyHtml).toContain("<h3>Next steps</h3>");
    expect(a.bodyHtml).toContain('<a href="https://www.acme.test/contact" rel="noopener nofollow">our team</a>');
    expect(a.bodyHtml).not.toMatch(/javascript|<img|<h1|<h2>Acme wins|Posted 1 Oct|\(share\)|\(sidebar\)|\(menu\)|&nbsp;/);
  });

  it("drops the theme's loose labels and a trailing sign-up box, keeping loose text that reads as a paragraph", () => {
    // Modelled on smmt.co.uk (28 Oct): header, text and newsletter box share one <main>.
    const html = `<html><head><title>Path to zero - SMMT</title></head><body><main>
      <section><div class="category">News</div><span>CEO Update</span><h1>Path to zero</h1>
        <span>23 Oct 2026</span><div class="anchor-link">SCROLL TO DISCOVER</div></section>
      <div class="content"><p>${LONG} Our message is clear.</p>
        <div>${LONG} (loose but long)</div></div>
      <h2><u>SMMT Update</u></h2><h3>Sign up</h3>
      <div class="gform_wrapper"><div class="gform_heading"><p>Sign up to the SMMT Update Newsletter for weekly automotive news</p>
        <p>"*" indicates required fields</p></div><form><input name="email"></form></div>
      <a href="/news/">BACK TO ALL NEWS</a>
    </main></body></html>`;
    const body = parseArticle(html, "https://www.smmt.co.uk/path-to-zero/").bodyHtml;
    expect(body).toMatch(/^<p>This paragraph/);
    expect(body).toContain("(loose but long)");
    expect(body).toMatch(/\(loose but long\)\s*$/);
    expect(body).not.toMatch(/News|CEO Update|23 Oct|SCROLL|Sign up|required|BACK TO ALL/);
  });

  it("without any known container, takes the element with the most paragraph text", () => {
    const html = `<html><head><title>News</title></head><body>
      <div class="promo"><p>${LONG}</p></div>
      <div class="x"><p>${LONG}</p><p>${LONG}</p><p>${LONG}</p></div>
    </body></html>`;
    const a = parseArticle(html, "https://acme.test/n");
    expect(a.bodyHtml.match(/<p>/g)).toHaveLength(3);
    expect(a.excerpt).toBeNull();
    expect(a.imageUrl).toBeNull();
  });

  it("gives an empty body for a page with no article text", () => {
    expect(parseArticle("<html><body><p>Short.</p></body></html>", "https://acme.test/").bodyHtml).toBe("");
    expect(parseArticle("not html at all", "https://acme.test/").bodyHtml).toBe("");
  });
});

describe("withoutSiteName", () => {
  it("drops a site name after a bar, or after a dash when it names the site", () => {
    expect(withoutSiteName("ISF October Round-up! | ISF Ltd", "ISF Ltd", "https://isfyork.com/x")).toBe("ISF October Round-up!");
    expect(withoutSiteName("Six-figure grant helps Brandauer grow - Brandauer", null, "https://brandauer.co.uk/x")).toBe("Six-figure grant helps Brandauer grow");
  });

  it("keeps a dash that is part of the headline", () => {
    expect(withoutSiteName("New press brake installed - a first for the region", "Acme", "https://acme.test/x"))
      .toBe("New press brake installed - a first for the region");
    expect(withoutSiteName("  ", null, "https://acme.test/x")).toBeNull();
  });
});

describe("linkFirstMention", () => {
  const href = "https://smi.test/member/acme";

  it("links the first mention in body text, trying the name without its legal suffix", () => {
    const out = linkFirstMention("<h2>Acme Fabrication news</h2><p>Today Acme Fabrication &amp; partners opened. Acme Fabrication grew.</p>", "Acme Fabrication Ltd", href);
    expect(out).toBe(`<h2>Acme Fabrication news</h2><p>Today <a href="${href}">Acme Fabrication</a> &amp; partners opened. Acme Fabrication grew.</p>`);
  });

  it("skips a mention that is already a link, and matches whole words only", () => {
    const out = linkFirstMention('<p><a href="https://acme.test">Acme</a> and Acmeco work with Acme.</p>', "Acme", href);
    expect(out).toBe(`<p><a href="https://acme.test">Acme</a> and Acmeco work with <a href="${href}">Acme</a>.</p>`);
  });

  it("leaves the text alone when the company isn't named", () => {
    const html = "<p>We installed a laser.</p>";
    expect(linkFirstMention(html, "Acme Ltd", href)).toBe(html);
  });

  it("nameVariants peels legal suffixes", () => {
    expect(nameVariants("Acme Fabrication Ltd")).toEqual(["Acme Fabrication Ltd", "Acme Fabrication"]);
    expect(nameVariants("Bend (UK) Limited")).toEqual(["Bend (UK) Limited", "Bend (UK)", "Bend"]);
  });
});
