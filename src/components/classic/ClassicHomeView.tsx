import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { dealSlots } from "@/lib/adverts";
import { visibleHomeSections, type HomeSectionId } from "@/lib/home-sections";
import { weaveMemberNews } from "@/lib/member-news-weave";
import { AdSlot } from "@/components/AdSlot";
import { StoryCard } from "@/components/StoryCard";
import { FeaturedMemberCard, MachineCard, VideoCard } from "@/components/cards";
import {
  GhEventCard, GhLogoBand, GhNewsletterCard, GhNewsletterPanel, GhPublicationPanel, GhStatsBand,
} from "@/components/grid-home/cards";
import { Band } from "@/components/grid-home/ui";
import {
  belowFoldSequence, HOME_AD_WRAPPER, HOME_TOP_STORIES, phoneCap, phoneSequence, type BelowFoldPiece,
} from "@/app/(public)/home.grid";
import { uniqueFeaturedMembers } from "@/lib/featured-members";
import { excluding, type HomeData } from "@/app/(public)/home.data";

/**
 * Classic's home view (hook point `HomeView` in src/components/design-option.ts;
 * spec #68, ticket #73). Same props as Current's GridHome, and the same
 * content: every story, advert slot, supplier logo and featured member Current
 * shows is here too — only the arrangement differs.
 *
 *   · The "Newsroom": the first four stories as one large tile and three small
 *     ones, ranked #1–#4 (an ordered list, so the rank is in the markup too).
 *   · Section heads are an orange disc plus a large title (classic.css #73).
 *   · Featured members are a full-width row, not GridHome's sidebar. No side
 *     rails anywhere.
 *   · Story and member cards are the SHARED ones (components/StoryCard.tsx,
 *     components/cards.tsx), so the Classic cards ticket (#75) reaches this
 *     page by styling them (decisions.md 3). This module only lays them out.
 *
 * Commercial rules carried over from GridHome unchanged (read its header):
 *   · dealSlots is called once for home_1/2/3 and its result used as given.
 *   · The below-fold run is GridHome's own belowFoldSequence/phoneSequence, so
 *     the configured section order (GAPS A1.7) and the banner rhythm hold.
 *   · Member news is badged wherever it appears (StoryCard renders MemberBadge).
 */
export function ClassicHomeView({
  stories, memberNews, videos, events, newsletters, featuredMembers, featuredMachine, featuredEvent,
  adverts, showPlaceholders, storyTotal, memberCount, reach, homeSections,
}: HomeData) {
  const banners = dealSlots(adverts.banner, ["home_1", "home_2", "home_3"]);

  // Four stories in the Newsroom; More News takes the run straight after them,
  // up to the same story Current stops at, with member news woven in as on
  // Current (GAPS A9.3). Disjoint, so nothing repeats and nothing is skipped,
  // and the page shows exactly Current's stories.
  const newsroom = stories.slice(0, NEWSROOM_SIZE);
  const moreNews = weaveMemberNews({ carousel: stories.slice(NEWSROOM_SIZE, HOME_TOP_STORIES), alsoInFold: newsroom, memberNews });
  const placedStoryIds = new Set([...newsroom, ...moreNews].map((s) => s.id));
  const railNews = excluding(memberNews, placedStoryIds);
  const machine = featuredMachine?.machine;

  const upcomingEvents = events.filter((e) => e.slug !== featuredEvent?.slug).slice(0, 3);
  const issues = newsletters.filter((i) => i.web_slug);

  // Sold placements, each member once, as on GridHome and the member directory.
  const featured = uniqueFeaturedMembers(featuredMembers);

  const sectionContent: Record<HomeSectionId, ReactNode> = {
    videos: (
      <>
        <Band part="home-videos" inner="py-8">
          <DiscHead title="Latest videos" href="/video" seeAll="See all videos" />
          <div data-part="card-grid">
            {videos.slice(0, 3).map((v, i) => <div key={v.id} className={phoneCap(i)}><VideoCard video={v} /></div>)}
          </div>
          <div data-part="home-panels">
            <GhNewsletterPanel />
            <GhPublicationPanel />
          </div>
        </Band>
        {/* Full width, under the videos rather than beside them: Classic has
            no side rails. Paid inventory, so absent when nothing is sold. */}
        {featured.length > 0 && (
          <Band part="home-featured-members" inner="py-8">
            <DiscHead title="Featured members" href="/member" seeAll="See all members" />
            <ul data-part="carousel">
              {featured.map((m) => (
                <li key={m.slug}>
                  <FeaturedMemberCard member={{ ...m, category: m.industry ?? null }} variant="compact" />
                </li>
              ))}
            </ul>
          </Band>
        )}
      </>
    ),
    member_news: railNews.length > 0 && (
      <Band part="home-member-news" inner="py-8">
        <DiscHead title="Featured member news" href="/news" seeAll="More member news" />
        <div data-part="card-grid">
          {railNews.slice(0, 3).map((s, i) => <div key={s.id} className={phoneCap(i)}><StoryCard story={s} size="sm" /></div>)}
        </div>
      </Band>
    ),
    // Returns null itself when the pool is empty and placeholders are off.
    supplier_logos: <GhLogoBand adverts={adverts.supplier_logo} showPlaceholders={showPlaceholders} />,
    events: upcomingEvents.length > 0 && (
      <Band part="home-events" inner="py-8">
        <DiscHead title="Upcoming events" href="/event" seeAll="All events" />
        <div data-part="card-grid">
          {upcomingEvents.map((e) => <GhEventCard key={e.slug} event={e} />)}
        </div>
      </Band>
    ),
    newsletters: issues.length > 0 && (
      <Band part="home-newsletters" inner="py-8">
        <DiscHead title="Latest newsletters" href="/newsletters" seeAll="Newsletter archive" />
        <div data-part="card-grid">
          {issues.map((issue, i) => <div key={issue.number} className={phoneCap(i)}><GhNewsletterCard issue={issue} /></div>)}
        </div>
      </Band>
    ),
  };
  const hasContent: Record<HomeSectionId, boolean> = {
    videos: true,
    member_news: railNews.length > 0,
    supplier_logos: adverts.supplier_logo.length > 0 || showPlaceholders,
    events: upcomingEvents.length > 0,
    newsletters: issues.length > 0,
  };
  const rendered = visibleHomeSections(homeSections).filter((id) => hasContent[id]);

  const banner = (slotKey: "home_1" | "home_2" | "home_3") => (
    <Band part="home-band-ad" inner="py-6">
      <div className={HOME_AD_WRAPPER}>
        <AdSlot slotKey={slotKey} adverts={banners.get(slotKey) ?? []} showPlaceholders={showPlaceholders} path="/" />
      </div>
    </Band>
  );

  const pieces: Record<BelowFoldPiece, ReactNode> = {
    ...sectionContent,
    home_2: banner("home_2"),
    home_3: banner("home_3"),
    stats: <GhStatsBand storyTotal={storyTotal} memberCount={memberCount} reach={reach} />,
  };
  const seq = belowFoldSequence(rendered);
  // A phone lifts Upcoming events to the top of the run, as on Current (#33 C9).
  const liftEvents = phoneSequence(seq) !== seq;

  return (
    // One wrapper so classic.css can scope the home's layout to this page.
    <div data-part="home-page">
      {/* The page's one h1. Like Current, the home has no visible page title:
          the header's wordmark plays that part. */}
      <h1 data-part="page-title" className="sr-only">Sheet Metal Industries — UK sheet metal, fabrication and welding news</h1>

      {newsroom.length > 0 && (
        <Band part="home-newsroom" inner="pt-6 pb-6">
          <section aria-labelledby="home-newsroom-title">
            <DiscHead id="home-newsroom-title" title="Newsroom" />
            <ol data-part="home-newsroom-list">
              {newsroom.map((s, i) => (
                <li key={s.id} data-part="home-newsroom-tile">
                  {/* The list's order already carries the rank for assistive
                      technology, so the visible badge isn't read twice. */}
                  <span data-part="home-newsroom-rank" aria-hidden="true">#{i + 1}</span>
                  <StoryCard story={s} size={i === 0 ? "lg" : "sm"} showExcerpt={i === 0} />
                </li>
              ))}
            </ol>
          </section>
        </Band>
      )}

      {/* The rest of Current's fold: the two placement cards and More News. */}
      {(machine || featuredEvent || moreNews.length > 0) && (
        <Band part="home-fold" inner="py-6">
          {(machine || featuredEvent) && (
            <div data-part="home-placements">
              {machine && <MachineCard machine={machine} />}
              {featuredEvent && <GhEventCard event={featuredEvent} featured />}
            </div>
          )}
          {moreNews.length > 0 && (
            <section data-part="home-more-news" aria-labelledby="home-more-news-title">
              <DiscHead id="home-more-news-title" title="More news" href="/news" seeAll="All news" />
              <ul data-part="carousel">
                {moreNews.map((s) => <li key={s.id}><StoryCard story={s} size="sm" showExcerpt={false} /></li>)}
              </ul>
            </section>
          )}
        </Band>
      )}

      {banner("home_1")}

      {liftEvents && <div className="sm:hidden">{pieces.events}</div>}
      {seq.map((piece) => (
        <Fragment key={piece}>
          {piece === "events" && liftEvents ? <div className="max-sm:hidden">{pieces.events}</div> : pieces[piece]}
        </Fragment>
      ))}
    </div>
  );
}

/** Classic's section head: an orange disc (drawn by classic.css) and a large title, with an optional see-all link. */
function DiscHead({ title, href, seeAll, id }: { title: string; href?: string; seeAll?: string; id?: string }) {
  return (
    <div data-part="section-head">
      <h2 id={id} data-part="section-title">{title}</h2>
      {href && <Link href={href} data-part="see-all">{seeAll ?? "See all"} <span aria-hidden="true">→</span></Link>}
    </div>
  );
}

/** The Newsroom's ranked tiles, #1–#4. */
const NEWSROOM_SIZE = 4;
