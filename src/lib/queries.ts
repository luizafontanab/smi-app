import { publicDb, serviceDb } from "./db/server";
import { displayLocation } from "./location";
import { parseDateParam } from "./news-prefs";
import { seededShuffle } from "./shuffle";

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
  member: { slug: string; name: string; logo_path: string | null; status: string } | null;
};

const STORY_CARD = "id, slug, title, excerpt, cover_path, cover_focus, published_at, is_member_news, member:members(slug, name, logo_path, status)";

export async function publishedStories(opts: {
  limit?: number;
  offset?: number;
  category?: string;
  memberOnly?: boolean;
  /** Member-kind category slug — filters by the author-member's industry. */
  industry?: string;
  /** YYYY-MM-DD bounds on published_at; malformed values are ignored. */
  from?: string;
  to?: string;
  order?: "desc" | "asc";
} = {}) {
  const db = publicDb();
  // Category filtering via an inner join on the link table, not a pre-fetched
  // ID list: the old `.in("id", [...])` pulled every story_categories row for
  // the category first, which grows with the archive (1,992 stories imported).
  // An unknown slug still means "no filter", matching the old behaviour.
  let catId: number | null = null;
  if (opts.category) {
    const { data: cat } = await db.from("categories").select("id").eq("kind", "story").eq("slug", opts.category).single();
    catId = cat?.id ?? null;
  }
  // Industry filtering rides stories.member_id → members.category_id, same as
  // storiesByMemberCategory: the member embed becomes an inner join so the
  // filter actually restricts rows (a left embed would only null the member
  // out). Unknown slug again means "no filter".
  let industryId: number | null = null;
  if (opts.industry) {
    const { data: cat } = await db.from("categories").select("id").eq("kind", "member").eq("slug", opts.industry).single();
    industryId = cat?.id ?? null;
  }
  const base = industryId ? STORY_CARD_MEMBER_INNER : STORY_CARD;
  let q = db
    .from("stories")
    .select(catId ? `${base}, story_categories!inner(category_id)` : base, { count: "exact" })
    .eq("status", "published");
  if (opts.memberOnly) q = q.eq("is_member_news", true);
  if (catId) q = q.eq("story_categories.category_id", catId);
  if (industryId) q = q.eq("member.category_id", industryId);
  // Validated here too (not just at the page) so a malformed value can never
  // reach PostgREST as a filter, wherever the call comes from.
  const from = parseDateParam(opts.from);
  const to = parseDateParam(opts.to);
  if (from) q = q.gte("published_at", from);
  if (to) q = q.lte("published_at", `${to}T23:59:59.999`);
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

/** The member-kind ("Sector"/industry) list — industries bar, industry pages, directory. */
export async function memberCategories() {
  const db = publicDb();
  const { data } = await db.from("categories").select("slug, name").eq("kind", "member").order("name");
  return data ?? [];
}

/**
 * Fixed membership-type tags (GAPS A8.1) — distinct from `categories`: a
 * member's industry is a single FK, but a member can hold several of these
 * (Equipment Supplier, Service Provider, …), so it's a join table instead.
 */
export async function membershipTypes() {
  const db = publicDb();
  const { data } = await db.from("membership_types").select("slug, name").order("sort_order");
  return data ?? [];
}

// Same projection with the member embed as an inner join, so the industry
// filter can apply to it; stories with no member_id drop out, by design.
const STORY_CARD_MEMBER_INNER = STORY_CARD.replace("member:members(", "member:members!inner(");

/**
 * Stories for one industry, via stories.member_id → members.category_id.
 * Unknown slug returns null so /industry/[slug] can 404 — unlike
 * publishedStories, where an unknown category slug means "no filter".
 */
export async function storiesByMemberCategory(slug: string, opts: { limit?: number; offset?: number } = {}) {
  const db = publicDb();
  const { data: cat } = await db.from("categories").select("id, slug, name").eq("kind", "member").eq("slug", slug).maybeSingle();
  if (!cat) return null;
  const offset = opts.offset ?? 0;
  const { data, count } = await db
    .from("stories")
    .select(STORY_CARD_MEMBER_INNER, { count: "exact" })
    .eq("status", "published")
    .eq("member.category_id", cat.id)
    .order("published_at", { ascending: false })
    .range(offset, offset + (opts.limit ?? 12) - 1);
  return { category: { slug: cat.slug, name: cat.name }, stories: (data ?? []) as unknown as StoryCard[], total: count ?? 0 };
}

/**
 * "For you" (/news): fresh stories matching a mixed bag of slugs from the
 * viewed_cats cookie — story-kind slugs match via story_categories, member-kind
 * (industry) slugs via the author-member's category. PostgREST can't OR across
 * two different embeds, so this is one id lookup plus at most two card queries
 * run in parallel, merged newest-first and deduped.
 */
export async function forYouStories(slugs: string[], opts: { limit?: number; excludeIds?: string[] } = {}): Promise<StoryCard[]> {
  if (slugs.length === 0) return [];
  const db = publicDb();
  const limit = opts.limit ?? 10;
  const { data: cats } = await db.from("categories").select("id, kind").in("slug", slugs);
  const storyCatIds = (cats ?? []).filter((c) => c.kind === "story").map((c) => c.id);
  const memberCatIds = (cats ?? []).filter((c) => c.kind === "member").map((c) => c.id);
  const notIn = opts.excludeIds?.length ? `(${opts.excludeIds.join(",")})` : null;
  const runs = [];
  if (storyCatIds.length > 0) {
    let q = db
      .from("stories")
      .select(`${STORY_CARD}, story_categories!inner(category_id)`)
      .eq("status", "published")
      .in("story_categories.category_id", storyCatIds);
    if (notIn) q = q.not("id", "in", notIn);
    runs.push(q.order("published_at", { ascending: false }).limit(limit));
  }
  if (memberCatIds.length > 0) {
    let q = db
      .from("stories")
      .select(STORY_CARD_MEMBER_INNER)
      .eq("status", "published")
      .in("member.category_id", memberCatIds);
    if (notIn) q = q.not("id", "in", notIn);
    runs.push(q.order("published_at", { ascending: false }).limit(limit));
  }
  const results = await Promise.all(runs);
  const seen = new Set<string>();
  const merged: StoryCard[] = [];
  for (const { data } of results) {
    for (const row of (data ?? []) as unknown as StoryCard[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  merged.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  return merged.slice(0, limit);
}

/**
 * Cookie-less "For you" fallback: most-read stories of the recent window, from
 * rollups_daily (kind=story_view — pre-aggregated per story per day, the same
 * source console/analytics sums, and consent-clean since only consented events
 * ever reach it). serviceDb because rollups_daily is RLS-locked; only ids and
 * counts are read there, and the cards come back through the public
 * projection with the published filter re-applied.
 */
export async function mostViewedStories(opts: { days?: number; limit?: number; excludeIds?: string[] } = {}): Promise<StoryCard[]> {
  const limit = opts.limit ?? 10;
  const sinceDay = new Date(Date.now() - (opts.days ?? 30) * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await serviceDb()
    .from("rollups_daily")
    .select("story_id, count")
    .eq("kind", "story_view")
    .gte("day", sinceDay)
    .not("story_id", "is", null)
    .order("day", { ascending: false })
    .limit(4000); // bounded read (~stories × days); a directional top-10 is the point, not an exact census
  const excluded = new Set(opts.excludeIds ?? []);
  const byStory = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.story_id || excluded.has(r.story_id)) continue;
    byStory.set(r.story_id, (byStory.get(r.story_id) ?? 0) + r.count);
  }
  const topIds = [...byStory.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  if (topIds.length === 0) return [];
  const { data } = await publicDb().from("stories").select(STORY_CARD).eq("status", "published").in("id", topIds);
  const rank = new Map(topIds.map((id, i) => [id, i] as const));
  return ((data ?? []) as unknown as StoryCard[]).sort((a, b) => (rank.get(a.id) ?? limit) - (rank.get(b.id) ?? limit));
}

/** The author-member's industry (member-kind category) slug — feeds the viewed_cats cookie on story pages. */
export async function memberIndustrySlug(memberId: string | null | undefined): Promise<string | null> {
  if (!memberId) return null;
  const { data } = await publicDb().from("members").select("category:categories(slug)").eq("id", memberId).maybeSingle();
  const cat = (data as { category?: { slug: string } | { slug: string }[] | null } | null)?.category;
  return (Array.isArray(cat) ? cat[0]?.slug : cat?.slug) ?? null;
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

/**
 * Current featured-member placements, as a pure filter so the home page can
 * apply it to the activePlacements() result it already fetches (one round
 * trip, unchanged), while featuredMembers() below is the standalone form for
 * pages that need only these — the member directory's featured strip.
 */
export function featuredMemberPlacements(placements: Awaited<ReturnType<typeof activePlacements>>) {
  return placements.filter((p) => p.kind === "featured_member");
}

export async function featuredMembers() {
  return featuredMemberPlacements(await activePlacements());
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

const VIDEO_CARD = "id, slug, title, url, thumbnail_path, source, member:members(slug, name)";

export async function publishedVideos(opts: { limit?: number; offset?: number } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 8;
  const offset = opts.offset ?? 0;
  const { data, count } = await db
    .from("videos")
    .select(VIDEO_CARD, { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return { videos: data ?? [], total: count ?? 0 };
}

/**
 * Pinned video wins its own featured slot on /video — unlike headlineStory()
 * this has no "latest" fallback: the grid below it already leads with latest,
 * so a fallback here would just duplicate that row.
 */
export async function headlineVideo() {
  const db = publicDb();
  const { data } = await db
    .from("videos")
    .select(VIDEO_CARD)
    .eq("status", "published")
    .gt("pinned_until", new Date().toISOString())
    .order("pinned_until", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
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

const EVENT_FIELDS = "slug, title, location, lat, lng, starts_on, starts_time, ends_on, link, description, cover_path, type, member:members(slug, name)";

/** Shared by all three event reads: repair legacy ACF map blobs in one place. */
function withDisplayLocation<T extends { location: string | null }>(rows: T[] | null) {
  return (rows ?? []).map((e) => ({ ...e, location: displayLocation(e.location) }));
}

export async function upcomingEvents(opts: { limit?: number; offset?: number; type?: string; q?: string } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 6;
  const offset = opts.offset ?? 0;
  const term = ilikeTerm(opts.q ?? "");
  let query = db
    .from("events")
    .select(EVENT_FIELDS, { count: "exact" })
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10));
  if (opts.type) query = query.eq("type", opts.type);
  if (term) query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`);
  const { data, count } = await query.order("starts_on").range(offset, offset + limit - 1);
  return { events: withDisplayLocation(data), total: count ?? 0 };
}

/**
 * Everything already finished, newest first.
 *
 * The old site kept its event pages up indefinitely — 56 of them, most long
 * past. Listing only what is upcoming silently retired each URL the morning
 * after its date, which is the one behaviour a redirect map cannot rescue.
 */
export async function pastEvents(opts: { limit?: number; offset?: number } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;
  const { data, count } = await db
    .from("events")
    .select(EVENT_FIELDS, { count: "exact" })
    .eq("status", "published")
    .lt("starts_on", new Date().toISOString().slice(0, 10))
    .order("starts_on", { ascending: false })
    .range(offset, offset + limit - 1);
  return { events: withDisplayLocation(data), total: count ?? 0 };
}

/**
 * Published events starting in [start, end) — the /event calendar's visible
 * grid (whole weeks, so the range can spill into neighbouring months). Dates
 * are local YYYY-MM-DD strings to match the date-only columns. Multi-day
 * events are keyed by starts_on only — the calendar renders them on their
 * start day, not across the span.
 */
export async function eventsInRange(start: string, end: string) {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select("slug, title, starts_on, starts_time, ends_on, type")
    .eq("status", "published")
    .gte("starts_on", start)
    .lt("starts_on", end)
    .order("starts_on");
  return data ?? [];
}

/**
 * Every upcoming published event's pin fields, unpaged — the /event map plots
 * all of them regardless of which listing page is showing (same shape as the
 * member directory's pinRows). Coordinate filtering stays in the caller so it
 * can say "N of M with a known location".
 */
export async function upcomingEventPins() {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select("slug, title, lat, lng")
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10))
    .order("starts_on");
  return data ?? [];
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

type MemberFilterOpts = { categories?: string[]; services?: string[] };

/**
 * Resolves the category (single FK, OR-matched across the selected slugs)
 * and services (many-to-many join table) filters to id lists memberDirectory
 * and memberPins can both apply with `.in()`. Null means "not filtering on
 * this axis"; an empty array means "filtered to nothing matches".
 */
async function memberFilterIds(db: ReturnType<typeof publicDb>, opts: MemberFilterOpts) {
  const [catRows, typeRows] = await Promise.all([
    opts.categories?.length
      ? db.from("categories").select("id").eq("kind", "member").in("slug", opts.categories)
      : Promise.resolve({ data: null }),
    opts.services?.length
      ? db.from("membership_types").select("id").in("slug", opts.services)
      : Promise.resolve({ data: null }),
  ]);
  const categoryIds = catRows.data ? catRows.data.map((c) => c.id) : null;

  let serviceMemberIds: string[] | null = null;
  if (typeRows.data) {
    const typeIds = typeRows.data.map((t) => t.id);
    const { data: links } = typeIds.length
      ? await db.from("member_membership_types").select("member_id").in("membership_type_id", typeIds)
      : { data: [] };
    serviceMemberIds = [...new Set((links ?? []).map((l) => l.member_id))];
  }
  return { categoryIds, serviceMemberIds };
}

// members.id is a uuid — this never matches a real row, so an empty
// serviceMemberIds list correctly filters the result to nothing.
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

export async function memberDirectory(opts: MemberFilterOpts & { q?: string; limit?: number; offset?: number } = {}) {
  const term = ilikeTerm(opts.q ?? "");
  // A term that sanitises away to nothing ("%%%") is unusable, not "match all" —
  // same stance as searchSite, which returns nothing for an empty tsquery.
  if (opts.q?.trim() && !term) return { members: [], total: 0 };

  const db = publicDb();
  const { categoryIds, serviceMemberIds } = await memberFilterIds(db, opts);
  // `.order("name")` is NOT the display order — it pins the shuffle's input so
  // the same seed always permutes the same sequence (a DB with no ORDER BY may
  // return rows in a different order per query, which would break pagination).
  let q = db
    .from("members")
    .select("id, slug, name, logo_path, description, address, website, phone, contact_email, lat, lng, category:categories(slug, name)", { count: "exact" })
    .eq("status", "active")
    .order("name");
  if (categoryIds) q = q.in("category_id", categoryIds.length ? categoryIds : [-1]);
  if (serviceMemberIds) q = q.in("id", serviceMemberIds.length ? serviceMemberIds : [NO_MATCH_UUID]);
  // Separate PostgREST params are ANDed, so this is category AND services AND (name OR description).
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, count } = await q;

  // Display order is a daily-seeded shuffle, not alphabetical — every member
  // gets roughly the same visibility instead of the alphabet's head start.
  // Seeding by UTC day + the filter inputs keeps the order stable across a
  // day's pagination (the directory is a few hundred rows, so it is fetched
  // whole and offset/limit are sliced here in JS, after the shuffle) while
  // rotating it daily and per filter. memberPins stays alphabetical — a map's
  // ordering is spatial, so it has nothing to rotate.
  const seed = `${new Date().toISOString().slice(0, 10)}|${(opts.categories ?? []).join(",")}|${(opts.services ?? []).join(",")}|${opts.q ?? ""}`;
  let members = seededShuffle(data ?? [], seed);
  // No limit means the caller wants the whole filtered set (the homepage logo wall).
  if (opts.limit != null) members = members.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
  return { members, total: count ?? 0 };
}

/**
 * Map pins: the directory filtered exactly like memberDirectory but projected
 * to what Leaflet needs. The map shows every filtered match at once, so the
 * win is the projection — the full row carries description/address/contact
 * fields that would all be serialized into the client payload per member.
 * Null-coordinate rows are kept: the page reports "X of Y with a known
 * location" and needs the real Y.
 */
export async function memberPins(opts: MemberFilterOpts & { q?: string } = {}) {
  const term = ilikeTerm(opts.q ?? "");
  if (opts.q?.trim() && !term) return { members: [], total: 0 };
  const db = publicDb();
  const { categoryIds, serviceMemberIds } = await memberFilterIds(db, opts);
  let q = db.from("members").select("slug, name, lat, lng", { count: "exact" }).eq("status", "active").order("name");
  if (categoryIds) q = q.in("category_id", categoryIds.length ? categoryIds : [-1]);
  if (serviceMemberIds) q = q.in("id", serviceMemberIds.length ? serviceMemberIds : [NO_MATCH_UUID]);
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, count } = await q;
  return { members: data ?? [], total: count ?? 0 };
}

export async function memberBySlug(slug: string) {
  const db = publicDb();
  const { data: member } = await db
    .from("members")
    .select(
      "id, slug, name, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, category:categories(name), member_membership_types(membership_type:membership_types(slug, name))",
    )
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
  // Flatten the join row — the page only ever wants "this member's services".
  const { member_membership_types, ...rest } = member;
  const services = (member_membership_types ?? []).flatMap((r) => (r.membership_type ? [r.membership_type] : []));
  return { ...rest, services, stories: (stories ?? []) as unknown as StoryCard[] };
}

/** Site search: members rank first (query-level ordering — not stored bias). */
export async function searchSite(term: string, opts: { memberOnly?: boolean; limit?: number; offset?: number } = {}) {
  const db = publicDb();
  const escaped = term.replace(/[!&|:'()<>]/g, " ").trim().split(/\s+/).join(" & ");
  if (!escaped) return { members: [], stories: [], total: 0 };
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  let storyQuery = db.from("stories").select(STORY_CARD, { count: "exact" }).eq("status", "published").textSearch("search_tsv", escaped);
  if (opts.memberOnly) storyQuery = storyQuery.eq("is_member_news", true);
  const [members, stories] = await Promise.all([
    db.from("members").select("slug, name, description, logo_path").eq("status", "active").textSearch("search_tsv", escaped).limit(10),
    storyQuery.range(offset, offset + limit - 1),
  ]);
  return { members: members.data ?? [], stories: (stories.data ?? []) as unknown as StoryCard[], total: stories.count ?? 0 };
}

export async function sentNewsletters() {
  const db = publicDb();
  const { data } = await db
    .from("newsletter_issues")
    .select("number, subject, intro, web_slug, sent_at")
    .eq("status", "sent")
    .order("number", { ascending: false })
    .limit(200); // monthly issues — a bound here is ~17 years of archive
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
  const { data } = await db.from("static_pages").select("id, slug, title, body, collapsible").eq("slug", slug).maybeSingle();
  return data;
}
