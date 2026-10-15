/**
 * The company lines that close a story — each featured member's name, linking
 * to its website — and their styling hook (caps, larger, orange: globals.css
 * `p[data-company-link]`).
 *
 * The convention, from the imported WordPress bodies and Jas's own description:
 * the last paragraph holds nothing but one link, the company's name pointing at
 * its homepage — `<p><a href="…">AP&T Group</a></p>`, sometimes wrapped in
 * <strong>/<em>/<u>. A last paragraph with any other text in it ("…click here
 * to read more") is ordinary copy and is left alone.
 *
 * Shape alone is not enough to call it the company line, though: plenty of
 * stories also end on a lone link that is nothing of the kind ("Watch the
 * video" → YouTube). withCompanyLines only marks the author's closing link when
 * it is recognisably a featured member's — see there.
 *
 * Runs on ALREADY-SANITISED html, at render time, and only adds markup this
 * code controls — nothing is stored, so changing the rule later rewrites no
 * rows. Pure string work, so it runs on server and client alike.
 */
import { websiteUrl } from "@/lib/website-url";

const COMPANY_LINE = /<p>(\s*(?:<(?:strong|em|u)>\s*)*<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?<\/a>\s*(?:<\/(?:strong|em|u)>\s*)*)<\/p>(\s*)$/;

/** Marks a closing lone-link paragraph by shape alone — callers decide whether it is a member's (withCompanyLines). */
export function markCompanyLink(html: string): string {
  return html.replace(COMPANY_LINE, '<p data-company-link="">$1</p>$2');
}

export type CompanyLink = {
  name: string;
  /** Where the line points — the tracked click-through, never the raw website. */
  href: string;
  /** The member's own website, only to recognise an author's line that already links there. */
  website: string | null;
  primary: boolean;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "https://www.icee.co.uk/x" or "icee.co.uk" → "icee.co.uk"; null when it isn't a website (lib/website-url). */
function siteHost(url: string | null | undefined): string | null {
  const href = websiteUrl(url);
  return href ? new URL(href).hostname.replace(/^www\./, "") : null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * A company name reduced to what identifies it: case, punctuation, "&"/"and"
 * and a trailing legal suffix ignored — "AP&T Group Ltd." and "AP & T GROUP"
 * are the same company. Deliberately no fuzzier than that: a false match would
 * hide a member's own line behind somebody else's link.
 */
function nameKey(raw: string): string {
  return decodeEntities(raw)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ (?:ltd|limited|plc|llp|llc|inc|gmbh)$/, "")
    .replace(/ /g, "");
}

/**
 * A member's website click-through — /go/[memberId] looks the URL up from the
 * member's own row, counts the click in their stats (outbound_click) and drops
 * archived members. Same route as the Website button on their profile.
 */
export const memberWebsiteHref = (memberId: string) => `/go/${memberId}?kind=website`;

/**
 * The lines a story's featured members are owed, primary first: one per member
 * with a usable website on file — a value websiteUrl can't make a link of
 * ("n/a") would only send the click back to the member's own SMI page. Callers
 * pass members already gated by isMemberLinkable, in display order.
 */
export function companyLinksFor(
  members: readonly { id: string; name: string; website: string | null }[],
  primaryId: string | null,
): CompanyLink[] {
  return members
    .filter((m) => websiteUrl(m.website))
    .map((m) => ({ name: m.name, href: memberWebsiteHref(m.id), website: m.website, primary: m.id === primaryId }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * Every story about members ends with a line per featured member (Luiza,
 * 15 Oct — Jas 13/10 item 2: "all stories must always include a URL link back
 * to the client's website at the bottom"; co-featured members too).
 *
 * The author's own closing line is kept, never doubled. A closing lone link
 * counts as a member's line when it is recognisably theirs:
 *   · it points at that member's website domain, or
 *   · its text is that member's name (nameKey) — imported stories mostly end
 *     with the lead company's name pointing at a homepage that has since moved.
 * Only then is it marked and styled as a company line, and only the members it
 * covers are skipped. A closing link that is nobody's — "Watch the video" off
 * to YouTube — stays ordinary copy and every member still gets their own line
 * (review, 16 Oct: the old rule took any such link as the primary member's and
 * dropped their backlink, against Jas 13/10 item 2).
 */
export function withCompanyLines(html: string, links: readonly CompanyLink[]): string {
  const closing = html.match(COMPANY_LINE)?.[1] ?? null;
  const authorHosts = new Set(
    [...(closing ?? "").matchAll(/href="([^"]*)"/g)].map((m) => siteHost(m[1])).filter(Boolean),
  );
  const authorName = closing ? nameKey(closing.replace(/<[^>]*>/g, "")) : "";
  const covered = (l: CompanyLink) => {
    const host = siteHost(l.website);
    return (host != null && authorHosts.has(host)) || (authorName !== "" && nameKey(l.name) === authorName);
  };
  const owed = links.filter((l) => !covered(l));
  const body = owed.length < links.length ? markCompanyLink(html) : html;
  return (
    body +
    owed
      // aria-label carries the name in its own case: the line is styled
      // uppercase, and browsers hand the transformed text to screen readers,
      // where VoiceOver can spell a short all-caps name out letter by letter.
      .map((l) => `<p data-company-link=""><a href="${escapeHtml(l.href)}" target="_blank" rel="noopener" aria-label="${escapeHtml(l.name)}">${escapeHtml(l.name)}</a></p>`)
      .join("")
  );
}
