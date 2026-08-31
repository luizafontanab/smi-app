import { publicDb, serviceDb } from "./db/server";
import { displayLocation } from "./location";

export type StoryCard = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_path: string | null;
  /** {x, y, scale} crop box — jsonb, so read it through parseFocus(). */
  cover_focus: unknown;
  published_at: string | null;
  is_member_news: boolean;
  member: { slug: string; name: string; logo_path: string | null } | null;
};

const STORY_CARD = "id, slug, title, excerpt, cover_path, cover_focus, published_at, is_member_news, member:members(slug, name, logo_path)";

export async function publishedStories(opts: { limit?: number; offset?: number; category?: string; memberOnly?: boolean; order?: "desc" | "asc" } = {}) {
  const db = publicDb();
  let q = db.from("stories").select(STORY_CARD, { count: "exact" }).eq("status", "published");
  if (opts.memberOnly) q = q.eq("is_member_news", true);
  if (opts.category) {
    const { data: cat } = await db.from("categories").select("id").eq("kind", "story").eq("slug", opts.category).single();
    if (cat) {
      const { data: links } = await db.from("story_categories").select("story_id").eq("category_id", cat.id);
      q = q.in("id", (links ?? []).map((l) => l.story_id));
    }
  }
  const { data, count } = await q
    .order("published_at", { ascending: opts.order === "asc" })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 12) - 1);
  return { stories: (data ?? []) as unknown as StoryCard[], total: count ?? 0 };
}

/** Headline: pinned story wins (admin override), else latest published. */
export async function headlineStory(): Promise<StoryCard | null> {
  const db = publicDb();
  const { data: pinned } = await db
    .from("stories")
    .select(STORY_CARD)
    .eq("status", "published")
    .gt("pinned_until", new Date().toISOString())
    .order("pinned_until", { ascending: false })
    .limit(1);
  if (pinned?.length) return pinned[0] as unknown as StoryCard;
  const { stories } = await publishedStories({ limit: 1 });
  return stories[0] ?? null;
}

export async function storyBySlug(slug: string) {
  const db = publicDb();
  const { data } = await db
    .from("stories")
    .select(`${STORY_CARD}, member_id, body, categories:story_categories(category:categories(slug, name))`)
    .eq("status", "published")
    .eq("slug", slug)
    .single();
  return data;
}

/**
 * Bodies for the handful of stories the home hero puts on the stage.
 *
 * Deliberately a separate round trip rather than adding `body` to STORY_CARD:
 * that projection is shared with the news list, search and member pages, and a
 * body averages ~4.8KB of HTML — carrying it on every card would cost ~86KB a
 * page to render titles and dates. Only ~10% of stories have an excerpt, so the
 * hero needs this fallback; it asks for at most three rows.
 */
export async function storyIntros(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const db = publicDb();
  const { data } = await db.from("stories").select("id, body").eq("status", "published").in("id", ids);
  return new Map((data ?? []).map((r) => [r.id, r.body]));
}

export async function storyCategories() {
  const db = publicDb();
  const { data } = await db.from("categories").select("slug, name").eq("kind", "story").order("name");
  return data ?? [];
}

export async function activePlacements() {
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("placements")
    .select("kind, grid_position, config, member:members(slug, name, logo_path, description, address, category:categories(name)), machine:featured_machines(id, name, description, image_path, external_url, status, member:members(slug, name))")
    .lte("starts_on", today)
    .gte("ends_on", today);
  return data ?? [];
}

export type ActiveTakeover = { hex: string; bannerPath: string; memberSlug: string | null };

/**
 * Lightweight and separate from activePlacements(): that call is home-only and
 * fetches far more than a takeover needs, while this is read on every public
 * page via the shared layout. Same date-driven pattern as everywhere else —
 * no job flips this live or ends it.
 */
export async function activeTakeover(): Promise<ActiveTakeover | null> {
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("placements")
    .select("config, member:members(slug)")
    .eq("kind", "takeover")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .maybeSingle();
  const config = data?.config as { hex?: string; banner_path?: string } | undefined;
  if (!config?.hex || !config.banner_path) return null;
  return { hex: config.hex, bannerPath: config.banner_path, memberSlug: data?.member?.slug ?? null };
}

export async function publishedVideos(limit = 8) {
  const db = publicDb();
  const { data } = await db
    .from("videos")
    .select("id, slug, title, url, thumbnail_path, member:members(slug, name)")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function videoBySlug(slug: string) {
  const db = publicDb();
  const { data } = await db
    .from("videos")
    .select("id, slug, title, url, description, thumbnail_path, published_at, member:members(slug, name, logo_path)")
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

const EVENT_FIELDS = "slug, title, location, starts_on, starts_time, ends_on, link, description, cover_path, member:members(slug, name)";

/** Shared by all three event reads: repair legacy ACF map blobs in one place. */
function withDisplayLocation<T extends { location: string | null }>(rows: T[] | null) {
  return (rows ?? []).map((e) => ({ ...e, location: displayLocation(e.location) }));
}

export async function upcomingEvents(limit = 6) {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select(EVENT_FIELDS)
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10))
    .order("starts_on")
    .limit(limit);
  return withDisplayLocation(data);
}

/**
 * Everything already finished, newest first.
 *
 * The old site kept its event pages up indefinitely — 56 of them, most long
 * past. Listing only what is upcoming silently retired each URL the morning
 * after its date, which is the one behaviour a redirect map cannot rescue.
 */
export async function pastEvents(limit = 40) {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select(EVENT_FIELDS)
    .eq("status", "published")
    .lt("starts_on", new Date().toISOString().slice(0, 10))
    .order("starts_on", { ascending: false })
    .limit(limit);
  return withDisplayLocation(data);
}

export async function eventBySlug(slug: string) {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select(EVENT_FIELDS)
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  return data ? withDisplayLocation([data])[0] : null;
}

/**
 * Reduce a user term to a literal ILIKE substring. PostgREST parses `or=(…)` as a
 * comma/paren-delimited logic tree and ILIKE treats %, _ and * as wildcards, so a raw
 * term can silently widen the filter (`a,id.not.is.null` ORs in a match-everything leaf
 * and returns the whole directory; a stray `)` closes the group early) or corrupt it
 * (a trailing \ escapes our own closing wildcard). Same strip-then-collapse shape as
 * searchSite's tsquery escaping. Dots, colons, apostrophes and ampersands are safe and
 * deliberately kept — member names need them ("O'Brien & Sons Ltd.", "co.uk").
 */
export function ilikeTerm(raw: string): string {
  return raw
    .slice(0, 80)
    .replace(/[,()%_*\\"\x00]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function memberDirectory(opts: { category?: string; q?: string } = {}) {
  const term = ilikeTerm(opts.q ?? "");
  // A term that sanitises away to nothing ("%%%") is unusable, not "match all" —
  // same stance as searchSite, which returns nothing for an empty tsquery.
  if (opts.q?.trim() && !term) return [];

  const db = publicDb();
  let q = db
    .from("members")
    .select("slug, name, logo_path, description, address, website, phone, category:categories(slug, name)")
    .eq("status", "active")
    .order("name");
  if (opts.category) {
    const { data: cat } = await db.from("categories").select("id").eq("kind", "member").eq("slug", opts.category).single();
    if (cat) q = q.eq("category_id", cat.id);
  }
  // Separate PostgREST params are ANDed, so this is category AND (name OR description).
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data } = await q;
  return data ?? [];
}

export async function memberBySlug(slug: string) {
  const db = publicDb();
  const { data: member } = await db
    .from("members")
    .select("id, slug, name, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, testimonials, category:categories(name)")
    .in("status", ["active", "grace"])
    .eq("slug", slug)
    .single();
  if (!member) return null;
  const { data: stories } = await db
    .from("stories")
    .select(STORY_CARD)
    .eq("status", "published")
    .eq("member_id", member.id)
    .order("published_at", { ascending: false });
  return { ...member, stories: (stories ?? []) as unknown as StoryCard[] };
}

/** Site search: members rank first (query-level ordering — not stored bias). */
export async function searchSite(term: string) {
  const db = publicDb();
  const escaped = term.replace(/[!&|:'()<>]/g, " ").trim().split(/\s+/).join(" & ");
  if (!escaped) return { members: [], stories: [] };
  const [members, stories] = await Promise.all([
    db.from("members").select("slug, name, description, logo_path").eq("status", "active").textSearch("search_tsv", escaped).limit(10),
    db.from("stories").select(STORY_CARD).eq("status", "published").textSearch("search_tsv", escaped).limit(30),
  ]);
  return { members: members.data ?? [], stories: (stories.data ?? []) as unknown as StoryCard[] };
}

export async function sentNewsletters() {
  const db = publicDb();
  const { data } = await db
    .from("newsletter_issues")
    .select("number, subject, intro, web_slug, sent_at")
    .eq("status", "sent")
    .order("number", { ascending: false });
  return data ?? [];
}

export async function newsletterBySlug(slug: string) {
  const db = publicDb();
  const { data: issue } = await db
    .from("newsletter_issues")
    .select("number, subject, intro, sent_at, id")
    .eq("status", "sent")
    .eq("web_slug", slug)
    .single();
  if (!issue) return null;
  const { data: items } = await publicDb()
    .from("newsletter_items")
    .select("position, story:stories(slug, title, excerpt, cover_path, cover_focus)")
    .eq("issue_id", issue.id)
    .order("position");
  return { ...issue, items: items ?? [] };
}

export async function staticPage(slug: string) {
  const db = publicDb();
  // maybeSingle, not single: a miss here is a 404 to render, not an error to log
  const { data } = await db.from("static_pages").select("id, slug, title, body").eq("slug", slug).maybeSingle();
  return data;
}
