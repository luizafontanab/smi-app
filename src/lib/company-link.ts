/**
 * The company lines that close a story — each featured member's name, linking
 * to their SMI member page, then any company Jas picked from Bigin, linking to
 * its website — and their styling hook (caps, larger, orange: globals.css
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
  /** Where the line points: a member's SMI page, or a picked company's website. */
  href: string;
  /** The company's own website, only to recognise an author's line that already links there. */
  website: string | null;
  primary: boolean;
  /** Off-site, so it opens in a new tab. A member page is on SMI and doesn't. */
  external: boolean;
};

/**
 * A company Jas picked from Bigin to close the story (stories.closing_links).
 * bigin_id is null for one typed in by hand; url is stored already made a link.
 */
export type ClosingLink = { bigin_id: string | null; name: string; url: string };

/** More than this is a typo or a paste gone wrong, not a story's companies. */
export const MAX_CLOSING_LINKS = 10;

/** stories.closing_links as stored → the entries that can still be links; anything malformed is skipped. */
export function readClosingLinks(raw: unknown): ClosingLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const { bigin_id, name, url } = r as Record<string, unknown>;
    const href = typeof url === "string" ? websiteUrl(url) : null;
    if (typeof name !== "string" || !name.trim() || !href) return [];
    return [{ bigin_id: typeof bigin_id === "string" && bigin_id ? bigin_id : null, name: name.trim(), url: href }];
  });
}

/**
 * The console editor's picked companies, posted as parallel fields
 * (closing_link_bigin_id / _name / _url, one set per row). Undefined when the
 * form had no picker, so a form without one leaves the column alone.
 */
export function closingLinksFromForm(form: FormData): { value: ClosingLink[] | undefined } | { error: string } {
  if (!form.has("closing_links_sent")) return { value: undefined };
  const ids = form.getAll("closing_link_bigin_id").map(String);
  const names = form.getAll("closing_link_name").map((v) => String(v).trim());
  const urls = form.getAll("closing_link_url").map(String);
  if (names.length > MAX_CLOSING_LINKS) return { error: `A story can close with at most ${MAX_CLOSING_LINKS} company links.` };
  const value: ClosingLink[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].slice(0, 200);
    if (!name) continue;
    const url = websiteUrl(urls[i]);
    if (!url) return { error: `"${name}" needs a website address for its closing link. Type one in, or remove it.` };
    value.push({ bigin_id: ids[i] || null, name, url });
  }
  return { value };
}

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
 * The story's closing lines, primary member first:
 *   · one per featured member, linking to their SMI member page (Jas 13/10:
 *     "if they are member than i prefer to link to their membership page").
 *     Callers pass members already gated by isMemberLinkable, so every one has
 *     a page; their website is one click on from there.
 *   · then each company Jas picked from Bigin, linking to its website, in her
 *     order. One that is also a featured member (same name, nameKey, or same
 *     website domain) is left out: the member line already covers it.
 */
export function companyLinksFor(
  members: readonly { id: string; name: string; slug: string; website: string | null }[],
  primaryId: string | null,
  picked: readonly ClosingLink[] = [],
): CompanyLink[] {
  const memberLines: CompanyLink[] = members
    .map((m) => ({ name: m.name, href: `/member/${m.slug}`, website: m.website, primary: m.id === primaryId, external: false }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  const names = new Set(memberLines.map((l) => nameKey(l.name)));
  const hosts = new Set(memberLines.map((l) => siteHost(l.website)).filter(Boolean));
  const pickedLines: CompanyLink[] = [];
  for (const c of picked) {
    const href = websiteUrl(c.url);
    const host = siteHost(c.url);
    if (!href || names.has(nameKey(c.name)) || (host && hosts.has(host))) continue;
    names.add(nameKey(c.name));
    if (host) hosts.add(host);
    pickedLines.push({ name: c.name, href, website: c.url, primary: false, external: true });
  }
  return [...memberLines, ...pickedLines];
}

/**
 * Every story about members ends with a line per featured member (Luiza,
 * 15 Oct — Jas 13/10 item 2: "all stories must always include a URL link back
 * to the client's website at the bottom"; co-featured members too), and every
 * story with a line per company picked from Bigin.
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
      .map((l) => `<p data-company-link=""><a href="${escapeHtml(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ""} aria-label="${escapeHtml(l.name)}">${escapeHtml(l.name)}</a></p>`)
      .join("")
  );
}
