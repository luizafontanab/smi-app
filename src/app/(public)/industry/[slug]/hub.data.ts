import "server-only";
import { record, requestContext } from "@/lib/analytics";
import { industryBySlug, memberDirectory, pastEvents, publishedStories, publishedVideos, upcomingEvents } from "@/lib/queries";

/**
 * How much of each section the hub shows. Compositional, so they live here
 * rather than in queries.ts — same split home.data.ts documents.
 *
 * Ten across the board because every section is a horizontal carousel: a row
 * scrolls, so it costs no vertical space to carry more than fits on screen.
 */
const SECTION_LIMIT = 10;

/**
 * Everything /industry/[slug] needs, with the industry row resolved ONCE and
 * its id fanned out to the four sections. Passing the slug to each instead
 * would cost four identical single-row lookups per render.
 *
 * Null means "no such industry" — the page turns that into notFound(). That is
 * this function's contract alone: the listing filters it calls treat an unknown
 * slug as "no filter", which is the right answer for /news?industry=bogus and
 * the wrong one for a page whose whole subject is the industry.
 */
export async function loadIndustryHub(slug: string) {
  const industry = await industryBySlug(slug);
  if (!industry) return null;

  const [{ stories, total: storyTotal }, { members, total: memberTotal }, { videos, total: videoTotal }, upcoming, ctx] =
    await Promise.all([
      publishedStories({ industry: industry.id, limit: SECTION_LIMIT }),
      // memberDirectory takes the slug, not the id: its API resolves slugs
      // itself and its daily shuffle seed is built from the slug string, so an
      // id would quietly change which members rotate to the top.
      memberDirectory({ industries: [slug], limit: SECTION_LIMIT }),
      publishedVideos({ industry: industry.id, limit: SECTION_LIMIT }),
      upcomingEvents({ industry: industry.id, limit: SECTION_LIMIT }),
      requestContext(),
    ]);

  // Most industries will have nothing upcoming for long stretches, and a
  // permanently empty section is worse than the trade's event history — the
  // same argument pastEvents' own docblock makes for keeping those pages up.
  // A second round trip by necessity, and only when the first found nothing.
  const past = upcoming.events.length === 0 ? await pastEvents({ industry: industry.id, limit: SECTION_LIMIT }) : null;

  record([{ kind: "page_view", path: `/industry/${slug}`, ...ctx }]);

  return {
    industry,
    stories,
    storyTotal,
    members,
    memberTotal,
    videos,
    videoTotal,
    events: past?.events ?? upcoming.events,
    eventTotal: past?.total ?? upcoming.total,
    // The view heads the section with this. Showing finished events under a
    // bare "Events" heading is exactly the trap the fallback is meant to avoid.
    eventsTense: past ? ("past" as const) : ("upcoming" as const),
  };
}

export type IndustryHub = NonNullable<Awaited<ReturnType<typeof loadIndustryHub>>>;
