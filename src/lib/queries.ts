import { cache } from "react";
import { publicDb, serviceDb } from "./db/server";
import { displayLocation } from "./location";
import { isMemberLinkable, PUBLIC_MEMBER_STATUSES } from "./member-visibility";
import { parseDateParam } from "./news-prefs";
import { seededShuffle } from "./shuffle";
import { computeFacets, type FacetMember, type Facets } from "./member-facets";
import { allRows } from "./db/all-rows";
import { HOME_SECTIONS_KEY, resolveHomeSections, type HomeSections } from "./home-sections";

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
// `excerpt` here is the story_summary computed field (migration
// 20261015000004): the author's summary, else the opening of the body — so every
// card, link preview and newsletter has one. The forms read the raw column.
const STORY_CARD = "id, slug, title, excerpt:story_summary, cover_path, cover_focus, published_at, is_member_news, member:members!stories_member_id_fkey(slug, name, logo_path, status)";

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
    .select(`${STORY_CARD}, member_id, body, social_posts, categories:story_categories(category:categories(slug, name))`)
    .eq("status", "published")
    .eq("slug", slug)
    .single();
  return data;
}

/**
 * The members a published story features, primary first then by name (Jas
 * 13/10 item 12) — the tiles beside the article. publicDb on purpose: RLS
 * returns pairings only for published stories, and nulls the embed for an
 * archived or lapsed member, so what's left is what may be linked;
 * isMemberLinkable is the belt to that brace.
 */
export async function storyMembers(storyId: string, primaryId: string | null) {
  const { data } = await publicDb()
    .from("story_members")
    .select("member:members(id, slug, name, logo_path, website, status)")
    .eq("story_id", storyId);
  return (data ?? [])
    .map((r) => r.member)
    .filter(isMemberLinkable)
    .sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.name.localeCompare(b.name)));
}

/**
 * A story in ANY status, for /preview/story/[id] (Jas 13/10 items 10/15). The
 * service role is the point — RLS hides unpublished stories from everyone but
 * the owning member, and an admin previewing a draft is neither. So this must
 * only ever be called after lib/story-preview canPreviewStory has said yes.
 *
 * Same projection as storyBySlug plus what the permission check needs, and the
 * member embed carries `archived_at`: serviceDb skips the RLS that nulls an
 * archived member for anon reads, so isMemberLinkable needs the column to judge.
 */
export async function storyForPreview(id: string) {
  const { data } = await serviceDb()
    .from("stories")
    // one literal, not a concatenation: supabase-js infers the row type from it
    .select("id, slug, title, excerpt, cover_path, cover_focus, published_at, is_member_news, member_id, body, social_posts, status, source, member_draft, member:members!stories_member_id_fkey(slug, name, logo_path, status, archived_at), categories:story_categories(category:categories(slug, name))")
    .eq("id", id)
    .maybeSingle();
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

/** The industry list (Jas's ten) — industry bar, industry pages, directory filter. */
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
 * Fixed membership-type tags (GAPS A8.1) — distinct from `categories` and from
 * industries. A member can hold several (Equipment Supplier, Service Provider,
 * …), so it's a join table.
 */
export async function membershipTypes() {
  const db = publicDb();
  // id too: the join form posts ids, the same values CompanyPageForm posts.
  const { data } = await db.from("membership_types").select("id, slug, name").order("sort_order");
  return data ?? [];
}

/**
 * The Services vocabulary — the live site's /find-a-member "Services" filter,
 * many per member. Distinct from both the industries (Jas's ten) and the fixed
 * membership-type tags above.
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
    .select("kind, grid_position, config, member:members(slug, name, logo_path, description, address, status, archived_at, industry:industries!members_industry_id_fkey(name)), machine:featured_machines(id, name, description, image_path, external_url, video_url, status, member:members(slug, name, logo_path, status, archived_at))")
    // an unpaid, held placement isn't on the site until it's paid (6 Oct)
    .eq("awaiting_payment", false)
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
    .eq("awaiting_payment", false)
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
    .select("id, slug, title, url, description, thumbnail_path, published_at, member_id, member:members(slug, name, logo_path)")
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
 * The three member taxonomies are genuinely different things: `industries` is
 * Jas's ten-item list (a member can be in several, via member_industries; their
 * primary is members.industry_id), `services` is the many-to-many Services
 * vocabulary from the live /find-a-member filter, and `membershipTypes` is the
 * separate fixed 5-item list. `services` used to resolve against
 * membership_types, so the directory's "Services" filter was really a
 * membership-type filter under a wrong label.
 */
type MemberFilterOpts = { industries?: string[]; services?: string[]; membershipTypes?: string[] };

/**
 * The directory's members, already narrowed by the three many-to-many filters,
 * for memberDirectory and memberPins to chain their own select/filters onto.
 * The matching happens in the database (members_in_taxonomies, migration
 * 20261016000040): within an axis any selected slug matches, across axes all
 * must, and an axis with nothing selected doesn't filter. Industries match
 * every industry a member is in, not only their primary — a member offering
 * welding and bending is listed under both.
 *
 * It used to resolve each axis to member ids here and send them back as
 * `.in("id", ids)` — the join-row read was silently capped at PostgREST's max
 * rows, and a broad industry's id list could outgrow the GET URL. The slugs
 * now travel in the /rpc POST body, so neither limit applies.
 */
function filteredMembers(db: ReturnType<typeof publicDb>, opts: MemberFilterOpts) {
  // undefined, not null, for "not filtering": the argument is then left out of
  // the call and the function's own default (null) applies
  const axis = (slugs: string[] | undefined) => (slugs?.length ? slugs : undefined);
  return db.rpc(
    "members_in_taxonomies",
    { p_industries: axis(opts.industries), p_services: axis(opts.services), p_membership_types: axis(opts.membershipTypes) },
    { count: "exact" },
  );
}

export async function memberDirectory(opts: MemberFilterOpts & { q?: string; limit?: number; offset?: number } = {}) {
  const term = ilikeTerm(opts.q ?? "");
  // A term that sanitises away to nothing ("%%%") is unusable, not "match all" —
  // same stance as searchSite, which returns nothing for an empty tsquery.
  if (opts.q?.trim() && !term) return { members: [], total: 0 };

  // `.order("name")` is NOT the display order — it pins the shuffle's input so
  // the same seed always permutes the same sequence (a DB with no ORDER BY may
  // return rows in a different order per query, which would break pagination).
  let q = filteredMembers(publicDb(), opts)
    .select("id, slug, name, logo_path, description, address, website, phone, contact_email, lat, lng, industry:industries!members_industry_id_fkey(slug, name)")
    .eq("status", "active")
    .order("name");
  // Separate PostgREST params are ANDed, so this is the taxonomy filters AND (name OR description).
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
  let q = filteredMembers(publicDb(), opts).select("slug, name, lat, lng").eq("status", "active").order("name");
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, count } = await q;
  return { members: data ?? [], total: count ?? 0 };
}

/**
 * Which directory filter options still lead somewhere (GAPS A9.1) — see
 * `computeFacets` for the rule. Returns null when nothing is filtered, because
 * then every option is available and the page needs no extra reads at all.
 *
 * Applies memberDirectory's own visibility (publicDb, so archived members are
 * already gone via RLS; status active) and keyword match, so an option never
 * disagrees with the result list beside it.
 */
export async function memberFacets(opts: MemberFilterOpts & { q?: string }): Promise<Facets | null> {
  const selection = { industries: opts.industries ?? [], services: opts.services ?? [], membershipTypes: opts.membershipTypes ?? [] };
  const term = ilikeTerm(opts.q ?? "");
  const filtering = selection.industries.length || selection.services.length || selection.membershipTypes.length || term;
  if (!filtering) return null;
  if (opts.q?.trim() && !term) return computeFacets([], selection);

  const db = publicDb();
  const [members, industryLinks, serviceLinks, typeLinks] = await Promise.all([
    allRows<{ id: string }>((from, to) => {
      let q = db.from("members").select("id").eq("status", "active").order("id");
      if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
      return q.range(from, to);
    }),
    allRows<{ member_id: string; industry: { slug: string } | null }>((from, to) =>
      db.from("member_industries").select("member_id, industry:industries(slug)").order("member_id").order("industry_id").range(from, to)),
    allRows<{ member_id: string; service: { slug: string } | null }>((from, to) =>
      db.from("member_services").select("member_id, service:services(slug)").order("member_id").order("service_id").range(from, to)),
    allRows<{ member_id: string; type: { slug: string } | null }>((from, to) =>
      db.from("member_membership_types").select("member_id, type:membership_types(slug)").order("member_id").order("membership_type_id").range(from, to)),
  ]);

  const byMember = new Map<string, FacetMember & { industries: Set<string>; services: Set<string>; types: Set<string> }>();
  for (const m of members) byMember.set(m.id, { industries: new Set(), services: new Set(), types: new Set() });
  // Links to members outside the visible set (archived, lapsed, keyword miss)
  // simply find no entry and drop out.
  for (const l of industryLinks) if (l.industry) byMember.get(l.member_id)?.industries.add(l.industry.slug);
  for (const l of serviceLinks) if (l.service) byMember.get(l.member_id)?.services.add(l.service.slug);
  for (const l of typeLinks) if (l.type) byMember.get(l.member_id)?.types.add(l.type.slug);
  return computeFacets([...byMember.values()], selection);
}

/**
 * The grid homepage's section order and visibility (GAPS A1.7). serviceDb:
 * `settings` has RLS with no policies. Never throws and never returns a partial
 * layout — a failed read is the default layout, not an empty homepage.
 */
export async function homeSectionsSetting(): Promise<HomeSections> {
  try {
    const { data } = await serviceDb().from("settings").select("value").eq("key", HOME_SECTIONS_KEY).maybeSingle();
    return resolveHomeSections(data?.value);
  } catch {
    return resolveHomeSections(null);
  }
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
      "id, slug, name, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, archived_at, industry:industries!members_industry_id_fkey(name), member_membership_types(membership_type:membership_types(slug, name)), member_services(service:services(slug, name))",
    )
    .in("status", PUBLIC_MEMBER_STATUSES)
    .eq("slug", slug)
    .single();
  if (!member) return null;
  const [{ data: stories }, { data: videos }] = await Promise.all([
    // Every published story featuring this member — as primary or tagged
    // alongside others (Jas 13/10 item 12) — through story_members, which
    // holds the primary too. An inner embed keeps it one round trip with
    // ordering and paging still done by the database.
    db
      .from("stories")
      .select(`${STORY_CARD}, story_members!inner(member_id)`)
      .eq("status", "published")
      .eq("story_members.member_id", member.id)
      .order("published_at", { ascending: false }),
    // The member's own published videos, shown after the company video on
    // their page (GAPS A8.5) — already approval-gated, so no new table.
    db
      .from("videos")
      .select("slug, title, url")
      .eq("status", "published")
      .eq("member_id", member.id)
      .order("published_at", { ascending: false })
      .limit(12),
  ]);
  // Flatten both join rows. These are different lists and were previously
  // conflated: membership types were returned under the name `services`.
  const { member_membership_types, member_services, ...rest } = member;
  const membershipTypes = (member_membership_types ?? []).flatMap((r) => (r.membership_type ? [r.membership_type] : []));
  const services = (member_services ?? []).flatMap((r) => (r.service ? [r.service] : []));
  return { ...rest, membershipTypes, services, stories: (stories ?? []) as unknown as StoryCard[], videos: videos ?? [] };
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
    // Name/description AND services AND industry, ranked (GAPS A9.5) — see
    // 20260928000001_search_members.sql for why this is a function.
    db.rpc("search_members", { query: escaped, max_results: 10 }),
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
    .select("number, subject, intro, sent_at, scheduled_at, id")
    .eq("status", "sent")
    .eq("web_slug", slug)
    .single();
  if (!issue) return null;
  const [{ data: items }, { data: ads }] = await Promise.all([
    publicDb()
      .from("newsletter_items")
      .select("position, story:stories(slug, title, excerpt:story_summary, cover_path, cover_focus), video:videos(slug, title, thumbnail_path)")
      .eq("issue_id", issue.id)
      .order("position"),
    // Gap review area 5: the web version carries the issue's adverts too.
    // adverts and newsletter_ads have no anon policy, so this one read is the
    // service role — scoped to an issue already confirmed sent through the
    // anon client above, and to the columns the emailed issue itself exposes.
    serviceDb()
      .from("newsletter_ads")
      .select("position, after_item, advert:adverts(id, name, format, desktop_path, mobile_path, headline, body)")
      .eq("issue_id", issue.id)
      .order("position"),
  ]);
  return { ...issue, items: items ?? [], ads: ads ?? [] };
}

export async function staticPage(slug: string) {
  const db = publicDb();
  // maybeSingle, not single: a miss here is a 404 to render, not an error to log
  const { data } = await db.from("static_pages").select("id, slug, title, body, collapsible").eq("slug", slug).maybeSingle();
  return data;
}
