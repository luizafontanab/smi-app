import "server-only";
import { liveAdvertsByFormat, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { buildHero, withIntros } from "@/lib/hero";
import { activePlacements, featuredMemberPlacements, headlineStory, memberDirectory, publishedStories, publishedVideos, sentNewsletters, storyCategories, storyIntros, upcomingEvents } from "@/lib/queries";

/** Every advert format either design places on the home page. */
const HOME_AD_FORMATS = ["banner", "banner_narrow", "supplier_logo", "skyscraper", "mpu", "in_feed"] as const;

/**
 * Everything the home page needs, fetched once and shared by both designs.
 *
 * What belongs here vs. in a view module:
 *   INVARIANT   — true of the page whatever it looks like. Hero de-duplication
 *                 is the example: nothing the hero shows may reappear below it,
 *                 in either design. Lives here, so both designs inherit it.
 *   COMPOSITIONAL — a consequence of one design's layout, e.g. "the first eight
 *                 stories are in the carousel, the next six in the grid". Lives
 *                 in the view, because the other design places different counts.
 *
 * Adverts follow the same split: this returns the raw rotation pool, and each
 * view calls dealSlots() ONCE with its own slot keys. One call per render is
 * what stops the same advert being dealt into two positions on one page.
 */
export async function loadHome() {
  // Limits are sized so the hero can eat from the top of these lists (up to 3
  // stories and 2 videos) and every section below still fills.
  const [headline, { stories, total: storyTotal }, { stories: memberNews }, { videos }, { events }, placements, adverts, newsletters, { members: directory, total: memberCount }, categories, showPlaceholders, ctx] = await Promise.all([
    headlineStory(),
    publishedStories({ limit: 18 }),
    publishedStories({ limit: 8, memberOnly: true }),
    publishedVideos({ limit: 10 }),
    // Grid shows four; forge shows three and ignores the rest.
    upcomingEvents({ limit: 4 }),
    activePlacements(),
    liveAdvertsByFormat(HOME_AD_FORMATS),
    // The three below are grid-only today. They cost one query each and the
    // loader is shared, so forge simply doesn't read them.
    sentNewsletters(),
    memberDirectory({}),
    storyCategories(),
    showAdPlaceholders(),
    requestContext(),
  ]);

  const hero = buildHero(headline, stories, videos);
  // A second, much smaller round trip: only ~10% of stories carry an excerpt, so
  // the stage takes its opening lines from the body of the few that don't. It
  // cannot join the Promise.all above — it needs to know which stories were picked.
  const heroItems = withIntros(hero.items, await storyIntros(hero.needIntro));

  // Advert impressions are NOT recorded here — the browser reports them once the
  // artwork has loaded and been on screen (components/AdCreative.tsx → /api/seen).
  record([{ kind: "page_view", path: "/", ...ctx }]);

  return {
    heroItems,
    // All three lists are already hero-deduplicated — the invariant above.
    stories: stories.filter((s) => !hero.storyIds.has(s.id)),
    memberNews: memberNews.filter((s) => !hero.storyIds.has(s.id)),
    videos: videos.filter((v) => !hero.videoIds.has(v.id)),
    events,
    // Shared filter (queries.ts) — the member directory's featured strip uses
    // the same definition via featuredMembers().
    featuredMembers: featuredMemberPlacements(placements),
    featuredMachine: placements.find((p) => p.kind === "featured_machine"),
    newsletters: newsletters.slice(0, 3),
    // Logo wall, not a directory listing — members without a logo have nothing
    // to show in it, so they are filtered out here rather than in each view.
    directory: directory.filter((m) => m.logo_path).slice(0, 12),
    memberCount,
    // Every published story, not the 18 fetched above — the count already
    // rides along on that query's response, so grid's stats band is free.
    storyTotal,
    categories,
    adverts,
    showPlaceholders,
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;

/**
 * Drop items a view has already placed elsewhere on the page. Both designs need
 * "no story appears twice"; each decides for itself what counts as already
 * placed, so the rule lives here and the inputs come from the view.
 */
export function excluding<T extends { id: string }>(items: T[], used: Iterable<string>): T[] {
  const seen = used instanceof Set ? used : new Set(used);
  return items.filter((i) => !seen.has(i.id));
}
