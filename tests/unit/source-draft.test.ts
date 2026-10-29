import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareDraft } from "@/lib/sources/draft";
import type { Rewriter } from "@/lib/adapters/rewrite";

const { fetchText, fetchImage } = vi.hoisted(() => ({ fetchText: vi.fn(), fetchImage: vi.fn() }));
vi.mock("@/lib/sources/fetch", () => ({ fetchText, fetchImage }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://smi.test" }));

afterEach(() => {
  fetchText.mockReset();
  fetchImage.mockReset();
});

const LONG = "and the new machine is already running two shifts a day for customers across the region.";
const PAGE = `<html><head>
  <meta property="og:title" content="We install a laser">
  <meta property="og:description" content="Our new laser.">
  <meta property="og:image" content="https://acme.test/laser.jpg">
</head><body><article><p>We at Acme Fabrication installed a laser, ${LONG}</p></article></body></html>`;
const page = (body: string, ok = true) => ({ ok, status: ok ? 200 : 503, body, finalUrl: "https://acme.test/news/laser" });
const IMAGE = new File([new Uint8Array([1])], "cover.jpg", { type: "image/jpeg" });
const ACME = { name: "Acme Fabrication Ltd", slug: "acme" };
const INPUT = { url: "https://acme.test/news/laser", title: "Suggestion title", company: "Acme Fabrication Ltd", member: ACME };

const rewriter = (impl: Rewriter["toThirdPerson"]): Rewriter => ({ toThirdPerson: vi.fn(impl) });
const thirdPerson = rewriter(async (i) => ({
  ok: true, title: i.title.replace("We install", "Acme installs"), excerpt: i.excerpt?.replace("Our", "Its") ?? null,
  html: i.html.replace("We at Acme Fabrication", "Acme Fabrication"), unnamedWriter: false,
}));

describe("prepareDraft", () => {
  it("fills title, summary, body and cover; rewrites, then links the member", async () => {
    fetchText.mockResolvedValue(page(PAGE));
    fetchImage.mockResolvedValue(IMAGE);

    const draft = await prepareDraft(INPUT, thirdPerson);
    expect(draft).toEqual({
      title: "Acme installs a laser",
      excerpt: "Its new laser.",
      body: `<p><a href="https://smi.test/member/acme">Acme Fabrication</a> installed a laser, ${LONG}</p>`,
      cover: IMAGE,
      original: `<p>We at Acme Fabrication installed a laser, ${LONG}</p>`,
      rewritten: true,
      notes: [],
    });
    expect(thirdPerson.toThirdPerson).toHaveBeenCalledWith(expect.objectContaining({ company: "Acme Fabrication Ltd", title: "We install a laser" }));
    expect(fetchImage).toHaveBeenCalledWith("https://acme.test/laser.jpg");
  });

  it("keeps the article's own wording when the rewrite is skipped, and says why", async () => {
    fetchText.mockResolvedValue(page(PAGE));
    fetchImage.mockResolvedValue(IMAGE);
    const draft = await prepareDraft({ ...INPUT, member: null }, rewriter(async () => ({ ok: false, reason: "Not set up." })));
    expect(draft.rewritten).toBe(false);
    expect(draft.title).toBe("We install a laser");
    expect(draft.body).toBe(draft.original);
    expect(draft.notes).toEqual(["Not set up."]);
  });

  it("says so when the article speaks as \"I\" without naming the writer", async () => {
    fetchText.mockResolvedValue(page(PAGE));
    fetchImage.mockResolvedValue(IMAGE);
    const unnamed = rewriter(async (i) => ({ ok: true, title: i.title, excerpt: i.excerpt, html: i.html, unnamedWriter: true }));
    const draft = await prepareDraft({ ...INPUT, member: null }, unnamed);
    expect(draft.rewritten).toBe(true);
    expect(draft.notes).toEqual(['The article is written as "I" but doesn\'t say who wrote it, so "I" was attributed to the company. If you know who wrote it, put their name in.']);
  });

  it("an unreadable page gives a title-only draft and a note, without asking for a rewrite", async () => {
    fetchText.mockResolvedValue(page("", false));
    const never = rewriter(async () => { throw new Error("not called"); });
    const draft = await prepareDraft(INPUT, never);
    expect(draft).toEqual(expect.objectContaining({ title: "Suggestion title", body: "", original: "", cover: null, rewritten: false }));
    expect(draft.notes[0]).toMatch(/Couldn't read the article page/);
    expect(never.toThirdPerson).not.toHaveBeenCalled();
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("a bot-check page counts as unreadable", async () => {
    fetchText.mockResolvedValue(page("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"));
    expect((await prepareDraft(INPUT, thirdPerson)).notes[0]).toMatch(/Couldn't read the article page/);
  });

  it("notes a missing image and a member who isn't named", async () => {
    fetchText.mockResolvedValue(page(PAGE.replace(/<meta property="og:image"[^>]*>/, "")));
    const draft = await prepareDraft({ ...INPUT, member: { name: "Brightsteel", slug: "brightsteel" } }, thirdPerson);
    expect(draft.cover).toBeNull();
    expect(draft.notes).toEqual([
      "Brightsteel isn't named in the text, so no link to their member page was added.",
      "The article has no main image — add a cover by hand.",
    ]);
  });
});
