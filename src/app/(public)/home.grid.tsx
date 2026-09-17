import { dealSlots } from "@/lib/adverts";
import { AdSlot } from "@/components/AdSlot";
import {
  GhEventCard, GhLatestList, GhMachineCard, GhMemberRow, GhMoreNews,
  GhNewsletterPanel, GhPublicationPanel, GhStatsBand, GhStoryCard, GhVideoCard,
  type LatestItem,
} from "@/components/grid-home/cards";
import { Band, SectionHead } from "@/components/grid-home/ui";
import { excluding, type HomeData } from "./home.data";

/**
 * The grid home page. Above the fold is two equally-weighted news highlights
 * beside a column of the two placement cards (featured machine, featured
 * event); the rotating banner sits under them, then a More News carousel.
 * Styling comes from the designer's comps, docs/Sheet Metal Industries Home
 * v1.png and v2.png: a white ground broken by full-bleed grey and near-black
 * bands, flat hairline-bordered cards, uppercase display headlines, and orange
 * carrying the section labels.
 *
 * The palette lives in components/grid-home/ui.tsx and the --gh-* tokens in
 * globals.css; this module is composition and nothing else.
 *
 * No HomeHero here — the rotating banner in the top slot is a real, sold advert
 * placement (home_1) rather than an editorial hero, a deliberate exception to
 * the usual no-ad-above-the-fold stance (requirements/DESIGN-QUOTES.md §1) made
 * for this design.
 *
 * Commercial rules still in force (requirements/DESIGN-QUOTES.md §7):
 *   · Rotation stays random-uniform — dealSlots is called once per slot family
 *     and its order used as given, never reordered or filtered.
 *   · Member news is marked wherever it appears among industry news (the grid
 *     cards render MemberBadge off `is_member_news`, as the shared ones do).
 *
 * INVENTORY — read this before adding anything back. The only advert positions
 * on this page are the three banners, home_1/2/3. The eight home_rail_* logo
 * slots, the home_mpu_1 box, the supplier-logo wall and the featured-member
 * placement were all REMOVED on 17 Sep at the client's direction, pending a
 * rework of that part of the page. They render nowhere and report no
 * impressions, so a live booking against any of them currently shows a reader
 * nothing. Tracked in docs/HUMAN-TODO.md §14.3.
 */
export function GridHome({
  stories, memberNews, videos, events, newsletters, featuredMembers, featuredMachine,
  adverts, showPlaceholders, storyTotal, memberCount,
}: HomeData) {
  // One call per slot family. home_1/2/3 match forge's banner key names so
  // impression reporting stays comparable across designs.
  const banners = dealSlots(adverts.banner, ["home_1", "home_2", "home_3"]);

  // Compositional slicing: two highlights above the fold, a content spotlight,
  // and one story for the in-brief list — all disjoint so nothing repeats.
  const [lead, second, ...rest] = stories;
  const spotlight = rest[0];
  const briefStory = rest[1];
  // Wider than a static row needs: this is a carousel, so it should have
  // somewhere to scroll to rather than stopping one card past the edge.
  const moreNews = rest.slice(2, 10);
  const placedStoryIds = new Set([lead, second, spotlight, briefStory, ...moreNews].filter(Boolean).map((s) => s!.id));
  const railNews = excluding(memberNews, placedStoryIds);
  // Only the second placement is read: the first had the left rail, which this
  // design removed. See the inventory note in the file header.
  const member2 = featuredMembers[1]?.member;
  const machine = featuredMachine?.machine;

  // Comp v2's in-brief list — one row per content kind, whatever exists today.
  const brief: LatestItem[] = [
    briefStory && { eyebrow: "Latest news", label: briefStory.title, href: `/news/${briefStory.slug}` },
    events[0] && { eyebrow: "Upcoming event", label: events[0].title, href: `/event/${events[0].slug}` },
    videos[3] && { eyebrow: "New video", label: videos[3].title, href: `/video/${videos[3].slug}` },
    newsletters[0] && { eyebrow: "Newsletter", label: newsletters[0].subject, href: `/newsletters/${newsletters[0].web_slug}` },
    member2 && { eyebrow: "Featured member", label: member2.name, href: `/member/${member2.slug}` },
  ].filter((i): i is LatestItem => Boolean(i));

  return (
    <>
      {/* Grid has no editorial hero, so the page's h1 is visually the wordmark
          in the header — but the document still needs one. */}
      <h1 className="sr-only">Sheet Metal Industries — UK sheet metal, fabrication and welding news</h1>

      {/*
       * ── Above the fold ─────────────────────────────────────────────────
       * Two rows: the equal news highlights sit in row 1 and the More News
       * carousel fills row 2 beneath them, while the placement column spans
       * both. No items-start here on purpose — the two story cards stretch to
       * each other so their "Read more" links land on one line.
       */}
      <Band inner="pt-6">
        <div className="grid gap-4 lg:grid-cols-[4fr_4fr_3fr]">
          {lead && <GhStoryCard story={lead} size="lg" eyebrow={null} />}
          {second && <GhStoryCard story={second} size="lg" eyebrow={null} />}
          {/* The third column is the two placement cards, stacked, running the
              full height of the two rows beside it. */}
          {/* flex-1 on each card so the pair fills the two-row span exactly —
              the covers absorb the slack rather than leaving it under the
              second card. */}
          <div className="flex flex-col gap-4 lg:row-span-2">
            {machine && <div className="flex-1"><GhMachineCard machine={machine} /></div>}
            {events[0] && <div className="flex-1"><GhEventCard event={events[0]} /></div>}
          </div>
          <div className="lg:col-span-2">
            <GhMoreNews stories={moreNews} />
          </div>
        </div>
      </Band>

      {/* The rotating banner is a real advert slot, not an editorial hero —
          see the top-of-file note on the above-the-fold exception. */}
      <Band tone="grey" className="mt-10" inner="py-5">
        <AdSlot slotKey="home_1" adverts={banners.get("home_1") ?? []} showPlaceholders={showPlaceholders} path="/" />
      </Band>

      {/* ── Latest videos, with the in-brief list as a sidebar ───────────── */}
      <Band inner="py-12">
        <div className="grid items-start gap-5 lg:grid-cols-[9fr_3fr]">
          <div>
            <SectionHead title="Latest videos" href="/video" seeAll="See all videos" />
            <div className="grid gap-5 sm:grid-cols-3">
              {videos.slice(0, 3).map((v) => <GhVideoCard key={v.id} video={v} />)}
            </div>
          </div>
          <GhLatestList items={brief} />
        </div>
      </Band>

      <Band inner="pb-12">
        <AdSlot slotKey="home_2" adverts={banners.get("home_2") ?? []} showPlaceholders={showPlaceholders} path="/" />
      </Band>

      {/* ── Industry insight, newsletter and the magazine ────────────────── */}
      <Band tone="grey" inner="py-12">
        <div className="grid items-start gap-5 lg:grid-cols-[7fr_5fr]">
          {spotlight && (
            <div>
              <SectionHead title="Industry insight" href="/news" seeAll="All news" />
              <GhStoryCard story={spotlight} size="lg" eyebrow="Insight" />
            </div>
          )}
          {/* Stacked rather than three across: the signup form needs a column
              wide enough for the field and its button to sit on one line. */}
          <div className="grid gap-5">
            <GhNewsletterPanel />
            <GhPublicationPanel />
          </div>
        </div>
      </Band>

      {/* ── Member news ──────────────────────────────────────────────────── */}
      {railNews.length > 0 && (
        <Band inner="py-12">
          <SectionHead title="Featured member news" href="/news" seeAll="More member news" />
          <div className="grid gap-8 md:grid-cols-3">
            {railNews.slice(0, 3).map((s) => <GhMemberRow key={s.id} story={s} />)}
          </div>
        </Band>
      )}

      <Band inner="pb-12">
        <AdSlot slotKey="home_3" adverts={banners.get("home_3") ?? []} showPlaceholders={showPlaceholders} path="/" />
      </Band>

      <GhStatsBand storyTotal={storyTotal} memberCount={memberCount} />
    </>
  );
}
