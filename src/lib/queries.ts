import { publicDb, serviceDb } from "./db/server";

export type StoryCard = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_path: string | null;
  published_at: string | null;
  is_member_news: boolean;
  member: { slug: string; name: string; logo_path: string | null } | null;
};

const STORY_CARD = "id, slug, title, excerpt, cover_path, published_at, is_member_news, member:members(slug, name, logo_path)";

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
    .select("kind, grid_position, config, member:members(slug, name, logo_path, description, address, category:categories(name)), machine:featured_machines(id, name, description, image_path, external_url, member:members(slug, name))")
    .lte("starts_on", today)
    .gte("ends_on", today);
  return data ?? [];
}

export async function publishedVideos(limit = 8) {
  const db = publicDb();
  const { data } = await db
    .from("videos")
    .select("id, title, url, thumbnail_path, member:members(slug, name)")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function upcomingEvents(limit = 6) {
  const db = publicDb();
  const { data } = await db
    .from("events")
    .select("slug, title, location, starts_on, ends_on, link, description, member:members(slug, name)")
    .eq("status", "published")
    .gte("starts_on", new Date().toISOString().slice(0, 10))
    .order("starts_on")
    .limit(limit);
  return data ?? [];
}

export async function memberDirectory(category?: string) {
  const db = publicDb();
  let q = db
    .from("members")
    .select("slug, name, logo_path, description, address, website, phone, category:categories(slug, name)")
    .eq("status", "active")
    .order("name");
  if (category) {
    const { data: cat } = await db.from("categories").select("id").eq("kind", "member").eq("slug", category).single();
    if (cat) q = q.eq("category_id", cat.id);
  }
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
    .select("position, story:stories(slug, title, excerpt, cover_path)")
    .eq("issue_id", issue.id)
    .order("position");
  return { ...issue, items: items ?? [] };
}

export async function staticPage(slug: string) {
  const db = publicDb();
  const { data } = await db.from("static_pages").select("slug, title, body").eq("slug", slug).single();
  return data;
}
