import { getRewriter, type Rewriter } from "@/lib/adapters/rewrite";
import { siteUrl } from "@/lib/site-url";
import { linkFirstMention, parseArticle } from "./article";
import { fetchImage, fetchText } from "./fetch";
import { looksLikeChallenge } from "./extract";

/**
 * Everything "Start story" pre-loads a draft with, from the suggestion's
 * article page (Luiza, 28 Oct 2026): title, summary, body, cover image — the
 * text rewritten to third person, and the member's name linked to their page.
 *
 * Every step fails on its own and says so in `notes`: the draft is always
 * made, with whatever could be loaded (at worst, the suggestion's title — what
 * "Start story" made before this).
 */

export type DraftMember = { name: string; slug: string };

export type PreparedDraft = {
  title: string;
  excerpt: string | null;
  body: string;
  cover: File | null;
  /** The article's own body, before the rewrite — kept in story_originals. Empty when the page couldn't be read. */
  original: string;
  rewritten: boolean;
  notes: string[];
};

export async function prepareDraft(
  input: { url: string; title: string; company: string; member: DraftMember | null },
  rewriter: Rewriter = getRewriter(),
): Promise<PreparedDraft> {
  const notes: string[] = [];
  const page = await fetchText(input.url);
  if (!page.ok || !page.body || looksLikeChallenge(page.body)) {
    notes.push("Couldn't read the article page, so only its title was filled in — copy the text in from the link above.");
    return { title: input.title, excerpt: null, body: "", cover: null, original: "", rewritten: false, notes };
  }

  const article = parseArticle(page.body, page.finalUrl);
  let title = article.title ?? input.title;
  let excerpt = article.excerpt;
  let body = article.bodyHtml;
  const original = body;
  let rewritten = false;

  if (!body) {
    notes.push("Couldn't find the article text on its page — copy it in from the link above.");
  } else {
    const result = await rewriter.toThirdPerson({ company: input.company, title, excerpt, html: body });
    if (result.ok) {
      ({ title, excerpt } = result);
      body = result.html;
      rewritten = true;
    } else {
      notes.push(result.reason);
    }
  }

  // After the rewrite, so the model never sees (or moves) our own link.
  if (body && input.member) {
    const linked = linkFirstMention(body, input.member.name, `${siteUrl()}/member/${input.member.slug}`);
    if (linked === body) notes.push(`${input.member.name} isn't named in the text, so no link to their member page was added.`);
    body = linked;
  }

  const cover = article.imageUrl ? await fetchImage(article.imageUrl) : null;
  if (!cover) notes.push(article.imageUrl ? "The article's image couldn't be downloaded — add a cover by hand." : "The article has no main image — add a cover by hand.");

  return { title, excerpt, body, cover, original, rewritten, notes };
}
