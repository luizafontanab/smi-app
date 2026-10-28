import { SOCIAL_CHANNELS, socialLinks, type SocialKey } from "./social";
import { websiteUrl } from "./website-url";

export type MemberLink = {
  key: string;
  kind: "website" | "phone" | "social";
  /** The row's title: "Website", "Call", "LinkedIn". */
  label: string;
  /** The line under it: domain, number, handle — or the raw value when unlinkable. */
  detail: string | null;
  /** Through /go so the click is counted. Null for a social value that can't be linked. */
  href: string | null;
  /** Opens off-site in a new tab (everything but the phone's tel:). */
  external: boolean;
  /** One of the six known channels, so it has a brand glyph; null for an unknown extra key. */
  channel: SocialKey | null;
};

const isChannel = (key: string): key is SocialKey => SOCIAL_CHANNELS.some((c) => c.key === key);

/** "https://www.acme.co.uk/about" → "acme.co.uk/about" — what a reader recognises. */
function displayHost(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return u.hostname.replace(/^www\./i, "") + path;
  } catch {
    return url;
  }
}

/**
 * A member's public contact points → the rows of the profile's Links box:
 * website, then phone, then socials in SOCIAL_CHANNELS order. Every href goes
 * through /go/[memberId] (which re-resolves the target server-side and records
 * the click), exactly as the old Website/Call buttons and Follow links did.
 */
export function memberLinks(member: { id: string; website: string | null; phone: string | null; social: unknown }): MemberLink[] {
  const links: MemberLink[] = [];
  const site = websiteUrl(member.website);
  if (site) {
    links.push({ key: "website", kind: "website", label: "Website", detail: displayHost(site), href: `/go/${member.id}?kind=website`, external: true, channel: null });
  }
  const phone = member.phone?.trim();
  if (phone) {
    links.push({ key: "phone", kind: "phone", label: "Call", detail: phone, href: `/go/${member.id}?kind=phone`, external: false, channel: null });
  }
  for (const s of socialLinks(member.social)) {
    links.push({
      key: s.key,
      kind: "social",
      label: s.label,
      detail: s.href ? s.handle : s.value,
      href: s.href ? `/go/${member.id}?kind=social&platform=${encodeURIComponent(s.key)}` : null,
      external: true,
      channel: isChannel(s.key) ? s.key : null,
    });
  }
  return links;
}
