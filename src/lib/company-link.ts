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
 * Runs on ALREADY-SANITISED html, at render time, and only adds markup this
 * code controls — nothing is stored, so changing the rule later rewrites no
 * rows. Pure string work, so it runs on server and client alike.
 */
const COMPANY_LINE = /<p>(\s*(?:<(?:strong|em|u)>\s*)*<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?<\/a>\s*(?:<\/(?:strong|em|u)>\s*)*)<\/p>(\s*)$/;

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

/** "https://www.icee.co.uk/x" → "icee.co.uk"; null when it isn't a URL. */
function siteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A member's website click-through — /go/[memberId] looks the URL up from the
 * member's own row, counts the click in their stats (outbound_click) and drops
 * archived members. Same route as the Website button on their profile.
 */
export const memberWebsiteHref = (memberId: string) => `/go/${memberId}?kind=website`;

/**
 * The lines a story's featured members are owed, primary first: one per member
 * with a website on file. Callers pass members already gated by
 * isMemberLinkable, in display order.
 */
export function companyLinksFor(
  members: readonly { id: string; name: string; website: string | null }[],
  primaryId: string | null,
): CompanyLink[] {
  return members
    .filter((m) => m.website?.trim())
    .map((m) => ({ name: m.name, href: memberWebsiteHref(m.id), website: m.website, primary: m.id === primaryId }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * Every story about members ends with a line per featured member (Luiza,
 * 15 Oct — Jas 13/10 item 2: "all stories must always include a URL link back
 * to the client's website at the bottom"; co-featured members too).
 *
 * The author's own closing line is kept, never doubled: a member is skipped
 * when that line already links to their website's domain, and an author's line
 * that matches nobody is taken to be the primary member's — imported stories
 * mostly end with the lead company's name pointing at a homepage that has since
 * moved.
 */
export function withCompanyLines(html: string, links: readonly CompanyLink[]): string {
  const marked = markCompanyLink(html);
  const authorLine = marked.match(/<p data-company-link="">[\s\S]*<\/p>\s*$/)?.[0] ?? null;
  const authorHosts = new Set(
    [...(authorLine ?? "").matchAll(/href="([^"]*)"/g)].map((m) => siteHost(m[1])).filter(Boolean),
  );
  const matched = (l: CompanyLink) => {
    const host = siteHost(l.website);
    return host != null && authorHosts.has(host);
  };
  const anyMatched = links.some(matched);
  const owed = links.filter((l) => !matched(l) && !(authorLine && !anyMatched && l.primary));
  return (
    marked +
    owed
      .map((l) => `<p data-company-link=""><a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a></p>`)
      .join("")
  );
}
