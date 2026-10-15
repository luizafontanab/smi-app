import { Fragment, type ReactNode } from "react";
import { dealSlots } from "@/lib/adverts";
import { visibleHomeSections, type HomeSectionId } from "@/lib/home-sections";
import { weaveMemberNews } from "@/lib/member-news-weave";
import { AdSlot } from "@/components/AdSlot";
import {
  GhEventCard, GhFeaturedMembers, GhLogoBand, GhMachineCard, GhMemberRow, GhMoreNews,
  GhNewsletterCard, GhNewsletterPanel, GhPublicationPanel, GhStatsBand,
  GhStoryCard, GhVideoCard,
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
 * INVENTORY — read this before adding anything back. Three advert positions,
 * home_1, home_2 and home_3, all of them the full-width 1280×170 banner and
 * all dealt from one pool. At the client's direction (18 Sep) every banner on
 * this page is the same size, so the second position went back to the shared
 * home_2 key across the page rather than the 830×170 banner_narrow it briefly
 * took while it lived in the column beside the Featured members box.
 *
 * That leaves the banner_narrow FORMAT and the home_2_narrow slot registered —
 * in the enum, in advert_slots, in the console's pickers and in both seeds —
 * and rendering nowhere. Deliberately not ripped out;
 * see docs/HUMAN-TODO.md §14.5 before selling anyone that size.
 *
 * The featured-member placement is back, as the sidebar box. Still REMOVED
 * since 17 Sep, and rendering nowhere: the eight home_rail_* logo slots, the
 * home_mpu_1 box and the supplier-logo wall. A live booking against any of
 * those still shows a reader nothing. Tracked in docs/HUMAN-TODO.md §14.3.
 */
export function GridHome({
  stories, memberNews, videos, events, newsletters, featuredMembers, featuredMachine,
  adverts, showPlaceholders, storyTotal, memberCount, homeSections,
}: HomeData) {
  // One call, because a slot family is a FORMAT and all three positions now
  // take the same full-width banner. The keys match forge's so impression
  // reporting stays comparable across the two designs.
  const banners = dealSlots(adverts.banner, ["home_1", "home_2", "home_3"]);

  // Compositional slicing: two highlights above the fold, then the carousel
  // takes the run straight after them — disjoint, so nothing repeats.
  const [lead, second, ...rest] = stories;
  // Wider than a static row needs: this is a carousel, so it should have
  // somewhere to scroll to rather than stopping one card past the edge.
  // Member news rotates into it near the top instead of living only at the
  // foot of the page (GAPS A9.3) — capped so the fold stays ≤20% member.
  const moreNews = weaveMemberNews({
    carousel: rest.slice(0, 8),
    alsoInFold: [lead, second].filter((s): s is NonNullable<typeof s> => Boolean(s)),
    memberNews,
  });
  const placedStoryIds = new Set([lead, second, ...moreNews].filter(Boolean).map((s) => s!.id));
  const railNews = excluding(memberNews, placedStoryIds);
  const machine = featuredMachine?.machine;

  // events[0] is the fold's placement card, so the row below takes what's
  // after it. An issue with no web_slug has no page to link to.
  const upcomingEvents = events.slice(1, 4);
  const issues = newsletters.filter((i) => i.web_slug);

  /*
   * Sold featured-member placements, for the sidebar box. Deduplicated on slug
   * because a member can hold overlapping placements — the same rule and the
   * same one-liner as the directory's featured strip (member/page.tsx). It
   * doubles as the null-member filter: placements.member_id is nullable.
   *
   * Resolved here rather than inside the box because it also decides the
   * band's column classes below. Two predicates would eventually disagree and
   * leave a 3fr column of nothing down the left of the section.
   */
  const featured = [...new Map(
    featuredMembers.flatMap((p) => (p.member ? [[p.member.slug, p.member] as const] : [])),
  ).values()];


  /*
   * Each configurable section, keyed by id (GAPS A1.7). `hasContent` below says
   * which would actually render, so the banner rhythm is computed from what a
   * reader sees rather than from the configured list.
   */
  const sectionContent: Record<HomeSectionId, ReactNode> = {
    videos: (
      <>
        {/*
         * ── Latest videos, with the featured members box as a left sidebar ──
         *
         * The newsletter and magazine panels live inside this band rather than
         * in one of their own, so the sidebar can span both rows and finish
         * flush with their bottom edge. DOM order is videos → members → panels,
         * which is the reading order on a phone; the explicit col/row-start
         * classes put the sidebar back on the left at lg.
         *
         * No items-start: the sidebar has to stretch. That stretches the videos
         * column too, which is fine — the cards are already h-full.
         *
         * With nothing sold the box is absent, and the thing that has to give is
         * the COLUMN definition, not the placement classes — leaving
         * lg:grid-cols-[3fr_9fr] in place would drop the videos into the 3fr
         * column. Both class strings appear here whole so Tailwind's scanner
         * sees them.
         */}
        <Band inner="py-8">
          <div className={`grid gap-5 ${featured.length > 0 ? "lg:grid-cols-[3fr_9fr]" : ""}`}>
            <div className="lg:col-start-2 lg:row-start-1">
              <SectionHead title="Latest videos" href="/video" seeAll="See all videos" />
              <div className="grid gap-5 sm:grid-cols-3">
                {videos.slice(0, 3).map((v) => <GhVideoCard key={v.id} video={v} />)}
              </div>
            </div>
            <GhFeaturedMembers members={featured} className="lg:col-start-1 lg:row-start-1 lg:row-span-2" />
            {/* Side by side, not stacked: half of this column is still wide
                enough for the signup field and its button to sit on one line,
                and stacking them would leave the sidebar stretching past three
                member rows into a tall column of white. */}
            <div className="lg:col-start-2 lg:row-start-2">
              <div className="grid gap-5 sm:grid-cols-2">
                <GhNewsletterPanel />
                <GhPublicationPanel />
              </div>
            </div>
          </div>
        </Band>
      </>
    ),
    member_news: (
      <>
        {/* ── Member news ──────────────────────────────────────────────────── */}
        {railNews.length > 0 && (
          <Band inner="py-8">
            <SectionHead title="Featured member news" href="/news" seeAll="More member news" />
            <div className="grid gap-8 md:grid-cols-3">
              {railNews.slice(0, 3).map((s) => <GhMemberRow key={s.id} story={s} />)}
            </div>
          </Band>
        )}
      </>
    ),
    // Returns null itself when the pool is empty and placeholders are off.
    supplier_logos: (
      <>
        {/*
         * ── Supplier logo row ──────────────────────────────────────────────
         *
         * A separate visibility product from the featured-member box above it:
         * that sells a card in the sidebar, this sells a logo in a row. Sits
         * directly under member news so the two read as a pair without being
         * confused for one another.
         *
         * Costs no query — loadHome() already fetches `supplier_logo` as one of
         * HOME_AD_FORMATS, and forge has been rendering the same pool through
         * SupplierLogos all along; grid simply had nowhere for it to land.
         * GhLogoBand carries its own Band and returns null when the pool is
         * empty and placeholders are off, so an unsold row shows nothing rather
         * than an empty grey stripe.
         *
         * Passed whole, not through dealSlots: this is a format wall, not a
         * positional slot, and the rotation's order is used exactly as given —
         * never sorted, filtered or weighted (lib/adverts.ts:5-11).
         */}
        <GhLogoBand adverts={adverts.supplier_logo} showPlaceholders={showPlaceholders} />
      </>
    ),
    events: (
      <>
        {/*
         * ── Upcoming events, then the newsletter archive ───────────────────
         *
         * Both rows exist to put content between home_2 and home_3 rather than
         * two banners near each other, and both are free: loadHome() already
         * fetches four events and three sent issues for every render, and grid
         * was reading neither of them (the fold takes events[0] and nothing
         * else). No new query, no new limit to keep in step.
         *
         * The events row starts at index 1 — events[0] is the fold's placement
         * card, and showing it twice on one page is the thing to avoid.
         */}
        {upcomingEvents.length > 0 && (
          <Band inner="py-8">
            <SectionHead title="Upcoming events" href="/event" seeAll="All events" />
            <div className="grid gap-5 sm:grid-cols-3">
              {upcomingEvents.map((e) => <GhEventCard key={e.slug} event={e} />)}
            </div>
          </Band>
        )}
      </>
    ),
    newsletters: (
      <>
        {issues.length > 0 && (
          <Band inner="py-8">
            <SectionHead title="Latest newsletters" href="/newsletters" seeAll="Newsletter archive" />
            <div className="grid gap-5 sm:grid-cols-3">
              {issues.map((i) => <GhNewsletterCard key={i.number} issue={i} />)}
            </div>
          </Band>
        )}
      </>
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

  const home3 = (
    <>
      {/*
       * Grey, after the last section, whichever that is now (A1.7): the band
       * separates this advert from the editorial run above it.
       * py-8 rather than pb-8 — a tinted band needs its top padding too, or the
       * artwork sits flush against the colour change.
       */}
      <Band tone="grey" inner="py-8">
        <AdSlot slotKey="home_3" adverts={banners.get("home_3") ?? []} showPlaceholders={showPlaceholders} path="/" />
      </Band>
    </>
  );

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
            {events[0] && <div className="flex-1"><GhEventCard event={events[0]} featured /></div>}
          </div>
          <div className="lg:col-span-2">
            <GhMoreNews stories={moreNews} />
          </div>
        </div>
      </Band>

      {/* The rotating banner is a real advert slot, not an editorial hero —
          see the top-of-file note on the above-the-fold exception. */}
      <Band tone="grey" className="mt-6" inner="py-4">
        <AdSlot slotKey="home_1" adverts={banners.get("home_1") ?? []} showPlaceholders={showPlaceholders} path="/" />
      </Band>

      {/*
       * ── Below the fold: configurable sections (GAPS A1.7) ───────────────
       *
       * The five editorial sections render in the order set on /console/pages
       * (settings.home_sections, lib/home-sections.ts), and hideable ones can
       * be switched off. The banners are NOT sections and keep their rhythm:
       * home_2 after the first rendered section, home_3 after the last, so a
       * banner always sits between content. The default order reproduces the
       * page exactly as it was before this was configurable.
       */}
      {rendered.map((id, i) => (
        <Fragment key={id}>
          {sectionContent[id]}
          {i === 0 && (
            /* Grey, like home_1 — the page alternates white and grey bands. */
            <Band tone="grey" inner="py-4">
              <AdSlot slotKey="home_2" adverts={banners.get("home_2") ?? []} showPlaceholders={showPlaceholders} path="/" />
            </Band>
          )}
          {i === rendered.length - 1 && rendered.length > 1 && home3}
        </Fragment>
      ))}
      {/* With a single section, home_3 would land straight under home_2 — two
          banners touching. It drops below the stats band instead. */}
      <GhStatsBand storyTotal={storyTotal} memberCount={memberCount} />
      {rendered.length <= 1 && home3}
    </>
  );
}
