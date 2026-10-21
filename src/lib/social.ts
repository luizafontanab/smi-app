/**
 * One source of truth for the six social channels SMI cares about
 * (requirements/01-public-site.md:21): display names, SMI's own accounts, and
 * the URL/handle resolution the member profile needs to render live links.
 *
 * Stored values are inconsistent by history — the WordPress import wrote full
 * URLs, scripts/seed.ts writes bare handles, and members typed either into a
 * form that asked for "handles". Everything here accepts both shapes and
 * resolves to an absolute http(s) URL, or to nothing at all.
 */

export type SocialKey = "linkedin" | "x" | "facebook" | "instagram" | "youtube" | "tiktok";

type Channel = {
  key: SocialKey;
  label: string;
  /** Canonical host used when building a URL from a bare handle. */
  host: string;
  /** Bare domains a stored value may already carry (any subdomain: uk.linkedin.com). */
  domains: string[];
  /** Path prefix a bare handle needs to become a profile URL ("" when it sits at the root). */
  handlePath: string;
  /** Root-level handles read as @name on these platforms. */
  atStyle: boolean;
  /** Path segments that merely namespace a handle — dropped from the display text. */
  containers: string[];
  placeholder: string;
};

export const SOCIAL_CHANNELS: readonly Channel[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    host: "www.linkedin.com",
    domains: ["linkedin.com"],
    handlePath: "company/",
    atStyle: false,
    containers: ["company", "in", "school", "showcase", "pub"],
    placeholder: "https://www.linkedin.com/company/your-company",
  },
  {
    key: "x",
    label: "X",
    host: "x.com",
    domains: ["x.com", "twitter.com"],
    handlePath: "",
    atStyle: true,
    containers: [],
    placeholder: "https://x.com/yourcompany",
  },
  {
    key: "facebook",
    label: "Facebook",
    host: "www.facebook.com",
    domains: ["facebook.com", "fb.com"],
    handlePath: "",
    atStyle: false,
    containers: ["pages"],
    placeholder: "https://www.facebook.com/yourcompany",
  },
  {
    key: "instagram",
    label: "Instagram",
    host: "www.instagram.com",
    domains: ["instagram.com"],
    handlePath: "",
    atStyle: true,
    containers: [],
    placeholder: "https://www.instagram.com/yourcompany",
  },
  {
    key: "youtube",
    label: "YouTube",
    host: "www.youtube.com",
    domains: ["youtube.com", "youtu.be"],
    handlePath: "@",
    atStyle: true,
    containers: ["c", "user", "channel"],
    placeholder: "https://www.youtube.com/@yourcompany",
  },
  {
    key: "tiktok",
    label: "TikTok",
    host: "www.tiktok.com",
    domains: ["tiktok.com"],
    handlePath: "@",
    atStyle: true,
    containers: [],
    placeholder: "https://www.tiktok.com/@yourcompany",
  },
];

/** SMI's own accounts, carried over from the WordPress footer. */
export const SMI_SOCIAL_URLS: Record<SocialKey, string> = {
  linkedin: "https://www.linkedin.com/company/sheet-metal-industries/",
  x: "https://x.com/SMIUK_",
  facebook: "https://www.facebook.com/SMIUK",
  instagram: "https://www.instagram.com/sheetmetalindustries",
  youtube: "https://www.youtube.com/channel/UCwg7Css79gc_adlmO3_fVxA",
  tiktok: "https://www.tiktok.com/@smiuk_",
};

const channelFor = (key: string) => SOCIAL_CHANNELS.find((c) => c.key === key) ?? null;

/** One channel's display details (label, host, placeholder) by key. */
export const socialChannel = channelFor;

const escapeDot = (s: string) => s.replace(/\./g, "\\.");

/** Does the value already start with this channel's domain, just without a scheme? */
const hasOwnHost = (channel: Channel, value: string) =>
  channel.domains.some((d) => new RegExp(`^([a-z0-9-]+\\.)*${escapeDot(d)}(/|$)`, "i").test(value));

/**
 * Stored value → absolute http(s) URL. Mirrors the scheme allowlist in
 * sanitize.ts: anything that isn't http(s) yields null so the caller renders
 * plain text rather than a dead or hostile link.
 */
export function socialHref(key: string, value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const channel = channelFor(key);

  let candidate: string;
  if (/^https?:\/\//i.test(raw)) {
    candidate = raw;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null; // some other scheme (javascript:, data:, mailto:) — never a handle
  } else if (channel && hasOwnHost(channel, raw)) {
    candidate = `https://${raw}`;
  } else if (channel) {
    const path = raw.replace(/^[/@]+/, "");
    // "company/acme" already carries its namespace; a bare "acme" needs one.
    const prefix = path.includes("/") ? "" : channel.handlePath;
    candidate = `https://${channel.host}/${prefix}${path}`;
  } else {
    return null; // unknown channel and not a URL — nothing safe to point at
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Routes and opaque ids that are not somebody's name. */
const isHandleLike = (segment: string) =>
  /^@?[A-Za-z0-9._-]{1,40}$/.test(segment) &&
  !/\.(php|html?|aspx)$/i.test(segment) &&
  !/^(watch|playlist|shorts|results|search|posts|profile|home|feed)$/i.test(segment) &&
  !/^UC[A-Za-z0-9_-]{20,}$/.test(segment); // youtube channel id, e.g. UCwg7Css79gc_adlmO3_fVxA

/**
 * Absolute URL → short readable link text ("@schulergroup", "schuler-group").
 * Null when the URL points at a video, a numeric profile.php or an opaque
 * channel id — the caller then links the platform name on its own rather than
 * printing noise.
 */
export function socialHandle(key: string, href: string): string | null {
  const channel = channelFor(key);
  let segments: string[];
  try {
    segments = new URL(href).pathname.split("/").filter(Boolean).map(decodeSegment);
  } catch {
    return null;
  }

  let atRoot = true;
  if (segments.length && channel?.containers.includes(segments[0].toLowerCase())) {
    segments = segments.slice(1);
    atRoot = false;
  }

  const segment = segments[0];
  if (!segment || !isHandleLike(segment)) return null;
  const bare = segment.replace(/^@+/, "");
  return segment.startsWith("@") || (atRoot && channel?.atStyle) ? `@${bare}` : bare;
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Profile-form input → the value to store. Merges over what's already there so
 * a channel the form doesn't show survives the save, and omits blanks rather
 * than storing "" (which showed as a dangling "Facebook:" row on the profile).
 */
export function mergeSocial(existing: unknown, read: (key: SocialKey) => string): Record<string, string> {
  const stored = existing && typeof existing === "object" && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {};
  const social: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string" && value.trim()) social[key] = value;
  }
  for (const { key } of SOCIAL_CHANNELS) {
    const value = read(key).trim();
    if (value) social[key] = value;
    else delete social[key];
  }
  return social;
}

export type SocialLink = {
  key: string;
  label: string;
  /** Null when the value resolves to nothing linkable — render `value` as text. */
  href: string | null;
  /** Null when no readable handle exists — link `label` on its own. */
  handle: string | null;
  value: string;
};

/**
 * A member's `social` jsonb → links ready to render, blanks dropped and
 * ordered consistently. Blanks matter: the profile form used to store "" for
 * every untouched field, which showed as dangling "Facebook:" rows.
 */
export function socialLinks(social: unknown): SocialLink[] {
  if (!social || typeof social !== "object" || Array.isArray(social)) return [];

  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(social as Record<string, unknown>)) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw) values.set(key.trim().toLowerCase(), raw);
  }

  const known = SOCIAL_CHANNELS.map((c) => c.key).filter((k) => values.has(k));
  const extra = [...values.keys()].filter((k) => !SOCIAL_CHANNELS.some((c) => c.key === k));

  return [...known, ...extra].map((key) => {
    const value = values.get(key)!;
    const href = socialHref(key, value);
    return {
      key,
      label: channelFor(key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1),
      href,
      handle: href ? socialHandle(key, href) : null,
      value,
    };
  });
}

/* ---------- SMI's own posts of a story (Jas 13/10 item 8) ---------- */

/**
 * The networks a story can link to SMI's own post on. Jas: readers rarely use a
 * website's share buttons; linking to the post on SMI's pages grows SMI's
 * reach, and people comment there with more confidence. Same three keys the
 * stories_social_posts_check constraint admits (migration 20261015000002).
 */
export const STORY_POST_CHANNELS = ["linkedin", "facebook", "x"] as const satisfies readonly SocialKey[];
export type StoryPostChannel = (typeof STORY_POST_CHANNELS)[number];

/**
 * The networks' own link-out and sign-in bounces. They sit on the right host,
 * so the host check passes them — but they forward wherever their parameter
 * says (facebook.com/l.php?u=…, linkedin.com/redir/redirect?url=…), which
 * would let "SMI's LinkedIn post" button send a reader anywhere. Review, 16 Oct.
 *   · hosts: Facebook's l./lm. link shims (l.instagram.com is the same shim,
 *     listed for when Instagram joins STORY_POST_CHANNELS);
 *   · paths: link shims, external-link warnings, share/intent dialogs, and
 *     sign-in/OAuth pages that take a return URL.
 * Real post shapes — /posts/…, /feed/update/…, /share/p/…, /status/…,
 * /i/web/status/… — are none of these.
 */
const REDIRECTOR_HOSTS = ["l.facebook.com", "lm.facebook.com", "l.instagram.com"];
const REDIRECTOR_PATHS =
  /^\/(?:l\.php|flx\/|dialog\/|sharer|share\.php|login|logout|checkpoint|redir\/|safety\/go|slink|authwall|uas\/|signup|i\/redirect|i\/flow\/|intent\/|share\/?$)/i;

/** A query parameter carrying a whole URL is how any redirector, listed or not, takes its target. */
const carriesUrl = (url: URL) =>
  [...url.searchParams.values()].some((v) => /^(?:https?:)?\/\//i.test(v.trim()));

/**
 * A pasted post URL → the value to store, or null when it isn't one: https
 * only, on that network's own host (any subdomain), and not one of the
 * network's redirectors. Stricter than socialHref, which also builds URLs from
 * bare handles — a post link must be pasted whole.
 *
 * The redirector check is app-level only; stories_social_posts_check
 * (20261015000002) still checks just scheme and host. Deliberately: every
 * stored value is re-validated through here before it is rendered
 * (storyPostLinks), so a redirector written behind the app's back is never
 * linked — and the only writer is the console's saveStory, through this. A
 * redirector blocklist in a CHECK would need a constraint drop/recreate each
 * time a network adds a path.
 */
export function storyPostUrl(key: StoryPostChannel, raw: string): string | null {
  const value = raw.trim();
  if (!/^https:\/\//i.test(value)) return null;
  const channel = channelFor(key);
  if (!channel) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const onHost = channel.domains.some((d) => host === d || host.endsWith(`.${d}`));
    if (url.protocol !== "https:" || !onHost) return null;
    if (REDIRECTOR_HOSTS.includes(host) || REDIRECTOR_PATHS.test(url.pathname) || carriesUrl(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The console form's three fields → the jsonb to store, or the first problem.
 * Blank fields are simply left out (the story page then falls back to SMI's
 * page on that network).
 */
export function parseStoryPosts(read: (key: StoryPostChannel) => string): { value: Partial<Record<StoryPostChannel, string>> } | { error: string } {
  const value: Partial<Record<StoryPostChannel, string>> = {};
  for (const key of STORY_POST_CHANNELS) {
    const raw = read(key).trim();
    if (!raw) continue;
    const url = storyPostUrl(key, raw);
    if (!url) {
      const label = channelFor(key)?.label ?? key;
      return { error: `That ${label} link isn't a ${label} post URL — paste the full https:// address of SMI's post.` };
    }
    value[key] = url;
  }
  return { value };
}

/**
 * Merge the editor's post links with what is stored now. A field whose value
 * is unchanged from when the form was rendered (`was`) wasn't touched, so the
 * stored value wins — it may have been filled from Buffer since. A field the
 * editor did change, including clearing it, is taken as given. With no `was`
 * (a direct POST, or a form from before this) the submitted value stands.
 */
export function keepUntouchedPosts(
  submitted: Partial<Record<StoryPostChannel, string>>,
  stored: unknown,
  was: (key: StoryPostChannel) => FormDataEntryValue | null,
): Partial<Record<StoryPostChannel, string>> {
  const current = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: Partial<Record<StoryPostChannel, string>> = {};
  for (const key of STORY_POST_CHANNELS) {
    const before = was(key);
    const untouched = typeof before === "string" && before.trim() === (submitted[key] ?? "");
    const value = untouched ? current[key] : submitted[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

export type StoryPostLink = { key: StoryPostChannel; label: string; href: string; isPost: boolean };

/**
 * The story page's social row: one link per network, to SMI's post of this
 * story where the editor pasted one, else to SMI's page on that network — so
 * the row is never empty and never dead. Stored values are re-validated here,
 * not trusted: the column is only as clean as its writers.
 */
export function storyPostLinks(stored: unknown): StoryPostLink[] {
  const posts = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return STORY_POST_CHANNELS.map((key) => {
    const raw = posts[key];
    const post = typeof raw === "string" ? storyPostUrl(key, raw) : null;
    return { key, label: channelFor(key)!.label, href: post ?? SMI_SOCIAL_URLS[key], isPost: Boolean(post) };
  });
}
