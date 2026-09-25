import { cache } from "react";
import { publicDb, serviceDb } from "./db/server";
import { displayLocation } from "./location";
import { isMemberLinkable, PUBLIC_MEMBER_STATUSES } from "./member-visibility";
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

// `members!stories_member_id_fkey`, not plain `members`: story_members
// (migration 20260924000001) gives PostgREST a second stories↔members path, so
// an unqualified embed is ambiguous and fails the whole query with PGRST201.
// Every embed of members *from stories* must name the FK. Embeds from videos,
// events, placements and adverts still have one path and are unaffected.
const STORY_CARD = "id, slug, title, excerpt, cover_path, cover_focus, published_at, is_member_news, member:members!stories_member_id_fkey(slug, name, logo_path, status)";

/**
 * Industry slug → industries.id, for the listing filters below.
 *
 * Accepts an id straight through so a caller that already holds the row does
 * not pay for the lookup again: /industry/[slug] resolves the industry once and
 * fans its id out to four sections, which would otherwise be four identical
 * single-row reads. null means "unknown slug", which every caller here treats
 * as "no filter" — industryBySlug is the one place a miss is a 404 instead.
 */
async function resolveIndustryId(
  db: ReturnType<typeof publicDb>,
  industry: string | number | undefined,
): Promise<number | null> {
  if (industry == null) return null;
  if (typeof industry === "number") return industry;
  // maybeSingle, not single: a miss here is an ordinary "no such industry",
  // not an error worth a PGRST116 row.
  const { data } = await db.from("industries").select("id").eq("slug", industry).maybeSingle();
  return data?.id ?? null;
}

export async function publishedStories(opts: {
  limit?: number;
  offset?: number;
  category?: string;
  memberOnly?: boolean;
  /** Industry slug, or a pre-resolved industries.id — filters on the story's own industry_id. */
  industry?: string | number;
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
    const { data: cat } = await db.from("categories").select("id").eq("slug", opts.category).single();
    catId = cat?.id ?? null;
  }
  // Industry is now the story's own column (migration 20260909000002), so this
  // is a plain filter — it no longer has to inner-join the member embed, and it
  // no longer misses editorial stories that have an industry but no member.
  // Unknown slug again means "no filter".
  const industryId = await resolveIndustryId(db, opts.industry);
  let q = db
    .from("stories")
    .select(catId ? `${STORY_CARD}, story_categories!inner(category_id)` : STORY_CARD, { count: "exact" })
    .eq("status", "published");
  if (opts.memberOnly) q = q.eq("is_member_news", true);
  if (catId) q = q.eq("story_categories.category_id", catId);
  if (industryId) q = q.eq("industry_id", industryId);
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

/** The news-topic list — the /news topic combobox. `categories` holds nothing else. */
export async function storyCategories() {
  const db = publicDb();
  const { data } = await db.from("categories").select("slug, name").order("name");
  return data ?? [];
}

/** The industry list — industry bar, industry pages, directory filter. */
export async function industries() {
  const db = publicDb();
  const { data } = await db.from("industries").select("slug, name").order("sort_order");
  return data ?? [];
}

/**
 * The industry row behind a public /industry/[slug] page, or null.
 *
 * Unlike every other industry-slug consumer here, a miss is a 404 rather than
 * "no filter" — which is why this is its own function and not an option on
 * resolveIndustryId. The page hands the resolved id to its four sections, so
 * the slug is looked up once per request rather than once per section.
 *
 * cache()d for the same reason siteVariant() and currentUser() are: Next runs
 * generateMetadata and the page body as separate invocations and both need the
 * row. That is an optimisation, not a correctness requirement — a second read
 * would return the same row.
 */
export const industryBySlug = cache(async (slug: string) => {
  const { data } = await publicDb().from("industries").select("id, slug, name").eq("slug", slug).maybeSingle();
  return data;
});

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

/**
 * The Services vocabulary — the live site's /find-a-member "Services" filter,
 * many per member. Distinct from both the single industry (`industries`)
 * and the fixed membership-type tags above.
 */
export async function services() {
  const db = publicDb();
  const { data } = await db.from("services").select("slug, name").order("name");
  return data ?? [];
}

/**
 * "For you" (/news): fresh stories matching a mixed bag of slugs from the
 * viewed_cats cookie — news-topic slugs match via story_categories, industry
 * slugs via the story's own industry_id. PostgREST can't OR across an embed and
 * a column, so this is two id lookups plus at most two card queries run in
 * parallel, merged newest-first and deduped.
 *
 * The cookie stores bare slugs with no marker of which vocabulary they came
 * from (see news-prefs.ts), so both tables are looked up and the matches are
 * unioned. Exactly one slug collides — `automation-robotics` is both a news
 * topic and an industry — and a reader who viewed one being shown the other is
 * a good recommendation, not a mistake, so this stays a union rather than
 * growing a discriminator.
 */
export async function forYouStories(slugs: string[], opts: { limit?: number; excludeIds?: string[] } = {}): Promise<StoryCard[]> {
  if (slugs.length === 0) return [];
  const db = publicDb();
  const limit = opts.limit ?? 10;
  const [{ data: cats }, { data: inds }] = await Promise.all([
    db.from("categories").select("id").in("slug", slugs),
    db.from("industries").select("id").in("slug", slugs),
  ]);
  const storyCatIds = (cats ?? []).map((c) => c.id);
  const industryIds = (inds ?? []).map((i) => i.id);
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
  if (industryIds.length > 0) {
    let q = db
      .from("stories")
      .select(STORY_CARD)
      .eq("status", "published")
      .in("industry_id", industryIds);
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

/**
 * A story's own industry slug — feeds the viewed_cats cookie on story pages.
 * Reads the story's industry_id directly rather than its author-member's, so an
 * editorial story with an industry but no member is now counted too.
 */
export async function storyIndustrySlug(storyId: string | null | undefined): Promise<string | null> {
  if (!storyId) return null;
  const { data } = await publicDb().from("stories").select("industry:industries(slug)").eq("id", storyId).maybeSingle();
  const ind = (data as { industry?: { slug: string } | { slug: string }[] | null } | null)?.industry;
  return (Array.isArray(ind) ? ind[0]?.slug : ind?.slug) ?? null;
}

/**
 * serviceDb, so RLS does NOT filter the member embeds here the way it does on
 * every publicDb read — `status` and `archived_at` are selected and applied in
 * code instead (isMemberLinkable), and a member who fails that test is returned
 * as a null embed rather than dropped: every consumer already guards on
 * `p.member` / `machine.member`, so a featured-member placement whose member is
 * archived renders as nothing while the machine beside it keeps its card and
 * only loses the seller credit.
 *
 * A left join, deliberately — placements.member_id is nullable and a takeover
 * or machine placement with no member must survive — so this cannot be a
 * PostgREST `!inner` filter.
 */
export async function activePlacements() {
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("placements")
    .select("kind, grid_position, config, member:members(slug, name, logo_path, description, address, status, archived_at, industry:industries(name)), machine:featured_machines(id, name, description, image_path, external_url, status, member:members(slug, name, status, archived_at))")
    .lte("starts_on", today)
    .gte("ends_on", today);
  return (data ?? []).map((p) => ({
    ...p,
    member: isMemberLinkable(p.member) ? p.member : null,
    machine: p.machine ? { ...p.machine, member: isMemberLinkable(p.machine.member) ? p.machine.member : null } : null,
  }));
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
    .select("config, member:members(slug, status, archived_at)")
    .eq("kind", "takeover")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .maybeSingle();
  const config = data?.config as { hex?: string; banner_path?: string } | undefined;
  if (!config?.hex || !config.banner_path) return null;
  // serviceDb again, so the member embed is unfiltered — the banner itself is
  // paid inventory and stays up for its term either way, but it stops linking
  // to a page the visitor cannot open.
  const member = data?.member ?? null;
  return { hex: config.hex, bannerPath: config.banner_path, memberSlug: isMemberLinkable(member) ? member.slug : null };
}

const VIDEO_CARD = "id, slug, title, url, thumbnail_path, source, member:members(slug, name)";

export async function publishedVideos(opts: { limit?: number; offset?: number; industry?: string | number } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 8;
  const offset = opts.offset ?? 0;
  const industryId = await resolveIndustryId(db, opts.industry);
  let q = db.from("videos").select(VIDEO_CARD, { count: "exact" }).eq("status", "published");
  if (industryId) q = q.eq("industry_id", industryId);
  const { data, count } = await q
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

export async function upcomingEvents(opts: { limit?: number; offset?: number; type?: string; q?: string; industry?: string | number } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 6;
  const offset = opts.offset ?? 0;
  const term = ilikeTerm(opts.q ?? "");
  const industryId = await resolveIndustryId(db, opts.industry);
  let query = db
    .from("events")
    .select(EVENT_FIELDS, { count: "exact" })
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10));
  if (opts.type) query = query.eq("type", opts.type);
  if (industryId) query = query.eq("industry_id", industryId);
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
export async function pastEvents(opts: { limit?: number; offset?: number; industry?: string | number } = {}) {
  const db = publicDb();
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;
  const industryId = await resolveIndustryId(db, opts.industry);
  let q = db
    .from("events")
    .select(EVENT_FIELDS, { count: "exact" })
    .eq("status", "published")
    .lt("starts_on", new Date().toISOString().slice(0, 10));
  if (industryId) q = q.eq("industry_id", industryId);
  const { data, count } = await q
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
export async function eventsInRange(start: string, end: string, opts: { industry?: string | number } = {}) {
  const db = publicDb();
  const industryId = await resolveIndustryId(db, opts.industry);
  let q = db
    .from("events")
    .select("slug, title, starts_on, starts_time, ends_on, type")
    .eq("status", "published")
    .gte("starts_on", start)
    .lt("starts_on", end);
  if (industryId) q = q.eq("industry_id", industryId);
  const { data } = await q.order("starts_on");
  return data ?? [];
}

/**
 * Every upcoming published event's pin fields, unpaged — the /event map plots
 * all of them regardless of which listing page is showing (same shape as the
 * member directory's pinRows). Coordinate filtering stays in the caller so it
 * can say "N of M with a known location".
 *
 * Industry is the one filter it does honour: paging and the type/search filters
 * narrow a page of a list, but an industry narrows what the page is *about*, and
 * a map pinning every trade's events beside a Welding listing reads as a bug.
 */
export async function upcomingEventPins(opts: { industry?: string | number } = {}) {
  const db = publicDb();
  const industryId = await resolveIndustryId(db, opts.industry);
  let q = db
    .from("events")
    .select("slug, title, lat, lng")
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10));
  if (industryId) q = q.eq("industry_id", industryId);
  const { data } = await q.order("starts_on");
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

/**
 * The three member taxonomies are genuinely different things (docs/ask-jas.md):
 * `industries` is the single industry per member, `services` is the many-to-many
 * Services vocabulary from the live /find-a-member filter, and `membershipTypes`
 * is the separate fixed 5-item list. `services` used to resolve against
 * membership_types, so the directory's "Services" filter was really a
 * membership-type filter under a wrong label.
 */
type MemberFilterOpts = { industries?: string[]; services?: string[]; membershipTypes?: string[] };

/** Members linked to any of `slugs` through a taxonomy join table. */
async function membersLinkedVia(
  db: ReturnType<typeof publicDb>,
  slugs: string[],
  table: "services" | "membership_types",
  join: "member_services" | "member_membership_types",
  fk: "service_id" | "membership_type_id",
) {
  const { data: terms } = await db.from(table).select("id").in("slug", slugs);
  const ids = (terms ?? []).map((t) => t.id);
  const { data: links } = ids.length
    ? await db.from(join).select("member_id").in(fk, ids)
    : { data: [] };
  return [...new Set((links ?? []).map((l) => l.member_id))];
}

/**
 * Resolves the industry (single FK, OR-matched across the selected slugs) plus
 * the two many-to-many filters to id lists memberDirectory and memberPins can
 * both apply with `.in()`. Null means "not filtering on this axis"; an empty
 * array means "filtered to nothing matches". The two member-id lists are
 * intersected, so services AND membership types both narrow the result.
 */
async function memberFilterIds(db: ReturnType<typeof publicDb>, opts: MemberFilterOpts) {
  const [indRows, serviceIds, typeIds] = await Promise.all([
    opts.industries?.length
      ? db.from("industries").select("id").in("slug", opts.industries)
      : Promise.resolve({ data: null }),
    opts.services?.length
      ? membersLinkedVia(db, opts.services, "services", "member_services", "service_id")
      : Promise.resolve(null),
    opts.membershipTypes?.length
      ? membersLinkedVia(db, opts.membershipTypes, "membership_types", "member_membership_types", "membership_type_id")
      : Promise.resolve(null),
  ]);
  const industryIds = indRows.data ? indRows.data.map((i) => i.id) : null;

  const memberIds =
    serviceIds && typeIds
      ? serviceIds.filter((id) => typeIds.includes(id))
      : serviceIds ?? typeIds;
  return { industryIds, serviceMemberIds: memberIds };
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
  const { industryIds, serviceMemberIds } = await memberFilterIds(db, opts);
  // `.order("name")` is NOT the display order — it pins the shuffle's input so
  // the same seed always permutes the same sequence (a DB with no ORDER BY may
  // return rows in a different order per query, which would break pagination).
  let q = db
    .from("members")
    .select("id, slug, name, logo_path, description, address, website, phone, contact_email, lat, lng, industry:industries(slug, name)", { count: "exact" })
    .eq("status", "active")
    .order("name");
  if (industryIds) q = q.in("industry_id", industryIds.length ? industryIds : [-1]);
  if (serviceMemberIds) q = q.in("id", serviceMemberIds.length ? serviceMemberIds : [NO_MATCH_UUID]);
  // Separate PostgREST params are ANDed, so this is industry AND services AND (name OR description).
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, count } = await q;

  // Display order is a daily-seeded shuffle, not alphabetical — every member
  // gets roughly the same visibility instead of the alphabet's head start.
  // Seeding by UTC day + the filter inputs keeps the order stable across a
  // day's pagination (the directory is a few hundred rows, so it is fetched
  // whole and offset/limit are sliced here in JS, after the shuffle) while
  // rotating it daily and per filter. memberPins stays alphabetical — a map's
  // ordering is spatial, so it has nothing to rotate.
  const seed = `${new Date().toISOString().slice(0, 10)}|${(opts.industries ?? []).join(",")}|${(opts.services ?? []).join(",")}|${(opts.membershipTypes ?? []).join(",")}|${opts.q ?? ""}`;
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
  const { industryIds, serviceMemberIds } = await memberFilterIds(db, opts);
  let q = db.from("members").select("slug, name, lat, lng", { count: "exact" }).eq("status", "active").order("name");
  if (industryIds) q = q.in("industry_id", industryIds.length ? industryIds : [-1]);
  if (serviceMemberIds) q = q.in("id", serviceMemberIds.length ? serviceMemberIds : [NO_MATCH_UUID]);
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, count } = await q;
  return { members: data ?? [], total: count ?? 0 };
}

/**
 * The member profile page's row, or null.
 *
 * `includeArchived` is the "visible to admin only" half of archiving (fix list
 * 72). It has to switch client as well as filter: `public_read_active_members`
 * now carries `archived_at is null`, so an archived member is simply not in
 * publicDb()'s result set and no application-level filter could put it back.
 * serviceDb() bypasses RLS, so only pass true once you have established the
 * caller is an admin — `src/app/(public)/member/[slug]/page.tsx` is the only
 * caller today and it reads `isAdmin(await currentUser())`.
 *
 * The status filter stays on in both modes: archiving is orthogonal to the
 * billing lifecycle, so an archived member's page is admin-visible but a lapsed
 * one's still 404s for everybody, exactly as it did before.
 */
export async function memberBySlug(slug: string, opts: { includeArchived?: boolean } = {}) {
  const db = opts.includeArchived ? serviceDb() : publicDb();
  const { data: member } = await db
    .from("members")
    .select(
      "id, slug, name, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, archived_at, industry:industries(name), member_membership_types(membership_type:membership_types(slug, name)), member_services(service:services(slug, name))",
    )
    .in("status", PUBLIC_MEMBER_STATUSES)
    .eq("slug", slug)
    .single();
  if (!member) return null;
  const { data: stories } = await db
    .from("stories")
    .select(STORY_CARD)
    .eq("status", "published")
    .eq("member_id", member.id)
    .order("published_at", { ascending: false });
  // Flatten both join rows. These are different lists and were previously
  // conflated: membership types were returned under the name `services`.
  const { member_membership_types, member_services, ...rest } = member;
  const membershipTypes = (member_membership_types ?? []).flatMap((r) => (r.membership_type ? [r.membership_type] : []));
  const services = (member_services ?? []).flatMap((r) => (r.service ? [r.service] : []));
  return { ...rest, membershipTypes, services, stories: (stories ?? []) as unknown as StoryCard[] };
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
