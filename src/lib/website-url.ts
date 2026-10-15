/**
 * A member's website as typed → an absolute http(s) URL fit to be an href or a
 * redirect target, or null when it can't be one.
 *
 * `members.website` has always been stored as typed, and people type
 * `www.foo.co.uk`. Handed to a redirect or an href as it stands, that is a
 * RELATIVE URL: /go/[memberId] sent the reader to /go/www.foo.co.uk, which has
 * no `kind` and so lands on the homepage — every story's company line for that
 * member, and the Website button on their profile, quietly went nowhere.
 *
 * Used at both ends: on save (lib/member-form), so new values are stored
 * clean, and wherever a stored value becomes a link (the /go redirect, the
 * company lines, JSON-LD), so rows saved before this existed work without a
 * data migration.
 *
 *   "www.foo.co.uk"            → "https://www.foo.co.uk"
 *   "http://foo.com/about"     → "http://foo.com/about"   (an explicit http is kept)
 *   "javascript:alert(1)"      → null                     (only http/https)
 *   "n/a", "see LinkedIn", ""  → null                     (no host with a TLD)
 *
 * Pure, no imports — runs on server and client alike.
 */
export function websiteUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  // Whitespace inside isn't a URL ("see our LinkedIn"); a leading "/" is a
  // path on our own site, not somebody else's.
  if (!value || /\s/.test(value) || (value.startsWith("/") && !value.startsWith("//"))) return null;

  let candidate: string;
  if (/^https?:/i.test(value)) candidate = value;
  // Any other scheme — javascript:, mailto:, ftp: — is refused. The (?!\d)
  // keeps a bare host with a port ("foo.com:8080") from reading as one.
  else if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(value)) return null;
  else candidate = `https://${value.replace(/^\/\//, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // user:pass@host is a phishing shape ("https://bank.com@evil.example"), never a homepage.
  if (url.username || url.password) return null;
  // A real public host: dotted, ending in an alphabetic (or punycode) TLD.
  // Rules out "localhost", bare words and IP literals.
  const labels = url.hostname.split(".");
  if (labels.length < 2 || labels.some((l) => !l) || !/^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/.test(labels[labels.length - 1])) {
    return null;
  }
  // URL adds a "/" to a bare host; drop it again so a homepage reads as typed.
  return url.pathname === "/" && !url.search && !url.hash ? url.href.slice(0, -1) : url.href;
}
