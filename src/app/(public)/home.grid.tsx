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
  stories, memberNews, videos, events, newsletters, featuredMembers, featuredMachine, featuredEvent,
  adverts, showPlaceholders, storyTotal, memberCount, reach, homeSections,
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
    carousel: rest.slice(0, HOME_CAROUSEL_STORIES),
    alsoInFold: [lead, second].filter((s): s is NonNullable<typeof s> => Boolean(s)),
    memberNews,
  });
  const placedStoryIds = new Set([lead, second, ...moreNews].filter(Boolean).map((s) => s!.id));
  const railNews = excluding(memberNews, placedStoryIds);
  const machine = featuredMachine?.machine;

  // The fold's placement card is the Featured Event (booked, pinned backup, or
  // next upcoming — queries.ts featuredEvent()), so the row below is the
  // upcoming list without it. loadHome() fetches four, so three always remain.
  // An issue with no web_slug has no page to link to.
  const upcomingEvents = events.filter((e) => e.slug !== featuredEvent?.slug).slice(0, 3);
  const issues = newsletters.filter((i) => i.web_slug);

  /*
   * Sold featured-member placements, for the sidebar box, each member once
   * (uniqueFeaturedMembers below; the directory's featured strip uses it too).
   *
   * Resolved here rather than inside the box because it also decides the
   * band's column classes below. Two predicates would eventually disagree and
   * leave a 3fr column of nothing down the left of the section.
   */
  const featured = uniqueFeaturedMembers(featuredMembers);


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
        <Band part="home-videos" inner="py-8">
          {/* grid-cols-1 for the same reason as the fold's: the Featured
              members box is a sideways scroller below lg, and an implicit
              track would grow to its full width and push the page sideways. */}
          <div className={`grid grid-cols-1 gap-5 ${featured.length > 0 ? "lg:grid-cols-[3fr_9fr]" : ""}`}>
            <div className="lg:col-start-2 lg:row-start-1">
              <SectionHead title="Latest videos" href="/video" seeAll="See all videos" />
              <div data-part="card-grid" className="grid gap-5 sm:grid-cols-3">
                {videos.slice(0, 3).map((v, i) => <div key={v.id} className={phoneCap(i)}><GhVideoCard video={v} /></div>)}
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
          <Band part="home-member-news" inner="py-8">
            <SectionHead title="Featured member news" href="/news" seeAll="More member news" />
            <div data-part="card-grid" className="grid gap-8 md:grid-cols-3">
              {railNews.slice(0, 3).map((s, i) => <div key={s.id} className={phoneCap(i)}><GhMemberRow story={s} /></div>)}
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
         * was reading neither of them. No new query, no new limit to keep in
         * step.
         *
         * The events row leaves out the fold's Featured Event card — showing
         * it twice on one page is the thing to avoid.
         */}
        {upcomingEvents.length > 0 && (
          <Band part="home-events" inner="py-8">
            <SectionHead title="Upcoming events" href="/event" seeAll="All events" />
            <div data-part="card-grid" className="grid gap-5 sm:grid-cols-3">
              {upcomingEvents.map((e) => <GhEventCard key={e.slug} event={e} />)}
            </div>
          </Band>
        )}
      </>
    ),
    newsletters: (
      <>
        {issues.length > 0 && (
          <Band part="home-newsletters" inner="py-8">
            <SectionHead title="Latest newsletters" href="/newsletters" seeAll="Newsletter archive" />
            <div data-part="card-grid" className="grid gap-5 sm:grid-cols-3">
              {issues.map((issue, i) => <div key={issue.number} className={phoneCap(i)}><GhNewsletterCard issue={issue} /></div>)}
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
      <Band tone="grey" part="home-band-ad" inner="py-8">
        <div className={HOME_AD_WRAPPER}><AdSlot slotKey="home_3" adverts={banners.get("home_3") ?? []} showPlaceholders={showPlaceholders} path="/" /></div>
      </Band>
    </>
  );

  const pieces: Record<BelowFoldPiece, ReactNode> = {
    ...sectionContent,
    home_2: (
      /* Grey, like home_1 — the page alternates white and grey bands. */
      <Band tone="grey" part="home-band-ad" inner="py-4">
        <div className={HOME_AD_WRAPPER}><AdSlot slotKey="home_2" adverts={banners.get("home_2") ?? []} showPlaceholders={showPlaceholders} path="/" /></div>
      </Band>
    ),
    home_3: home3,
    stats: <GhStatsBand storyTotal={storyTotal} memberCount={memberCount} reach={reach} />,
  };
  const seq = belowFoldSequence(rendered);
  // Whether a phone lifts Upcoming events to the top of the run (#33 C9).
  const liftEvents = phoneSequence(seq) !== seq;

  return (
    <>
      {/* Grid has no editorial hero, so the page's h1 is visually the wordmark
          in the header — but the document still needs one. */}
      <h1 data-part="page-title" className="sr-only">Sheet Metal Industries — UK sheet metal, fabrication and welding news</h1>

      {/*
       * ── Above the fold ─────────────────────────────────────────────────
       * Two rows: the equal news highlights sit in row 1 and the More News
       * carousel fills row 2 beneath them, while the placement column spans
       * both. No items-start here on purpose — the two story cards stretch to
       * each other so their "Read more" links land on one line.
       */}
      <Band part="home-fold" inner="pt-6">
        {/* grid-cols-1 below lg, not the implicit column: an implicit track
            grows to its widest child's min-content, and the More News row is
            ~1700px of fixed-width tiles, which pushed the whole page sideways
            on phones. minmax(0,1fr) caps it so the row scrolls in place. */}
        {/* md: the two highlights side by side and the placement pair as a
            row under them — at tablet width a single column made the first
            screen two 736px-wide cards (#33 C8). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[4fr_4fr_3fr]">
          {lead && <GhStoryCard story={lead} size="lg" eyebrow={null} />}
          {second && <GhStoryCard story={second} size="lg" eyebrow={null} />}
          {/* The third column is the two placement cards, stacked, running the
              full height of the two rows beside it. */}
          {/* flex-1 on each card so the pair fills the two-row span exactly —
              the covers absorb the slack rather than leaving it under the
              second card. */}
          <div data-part="home-placements" className="flex flex-col gap-4 md:col-span-2 md:flex-row lg:col-span-1 lg:row-span-2 lg:flex-col">
            {machine && <div className="flex-1"><GhMachineCard machine={machine} /></div>}
            {featuredEvent && <div className="flex-1"><GhEventCard event={featuredEvent} featured /></div>}
          </div>
          <div data-part="home-more-news" className="md:col-span-2">
            <GhMoreNews stories={moreNews} />
          </div>
        </div>
      </Band>

      {/* The rotating banner is a real advert slot, not an editorial hero —
          see the top-of-file note on the above-the-fold exception. */}
      <Band tone="grey" part="home-band-ad" className="mt-6" inner="py-4">
        <div className={HOME_AD_WRAPPER}><AdSlot slotKey="home_1" adverts={banners.get("home_1") ?? []} showPlaceholders={showPlaceholders} path="/" /></div>
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
      {/*
       * PHONES (#33 C9): Upcoming events lifted to the top of the run — at
       * 390px it sat ~4,400px down a 7,000px page. Only that one band is
       * rendered twice: a phone-only copy here, and the original hidden below
       * sm in its desktop place. Everything else, banners included, renders
       * once, so the page doesn't ship and hydrate a second copy of the run.
       * Done in the DOM rather than with CSS `order`, so reading and tab order
       * match what's on screen; the hidden copy is display:none, out of the
       * accessibility tree. phoneSequence() keeps the banners apart.
       */}
      {liftEvents && <div className="sm:hidden">{pieces.events}</div>}
      {seq.map((piece) => (
        <Fragment key={piece}>
          {piece === "events" && liftEvents ? <div className="max-sm:hidden">{pieces.events}</div> : pieces[piece]}
        </Fragment>
      ))}
    </>
  );
}

/** A piece of the below-fold run: a section, one of the two banners, or the stats band. */
export type BelowFoldPiece = HomeSectionId | "home_2" | "home_3" | "stats";

/**
 * The below-fold run in paint order: home_2 after the first section, home_3
 * after the last — or, with a single section, below the stats band, since
 * straight under home_2 it would put two banners together.
 */
export function belowFoldSequence(sections: HomeSectionId[]): BelowFoldPiece[] {
  const seq: BelowFoldPiece[] = [];
  sections.forEach((id, i) => {
    seq.push(id);
    if (i === 0) seq.push("home_2");
    if (i === sections.length - 1 && sections.length > 1) seq.push("home_3");
  });
  seq.push("stats");
  if (sections.length <= 1) seq.push("home_3");
  return seq;
}

/**
 * The below-fold run as a phone paints it: the desktop run with Upcoming
 * events moved to the front (#33 C9), every other piece — banners included —
 * where it was. Returns `desktop` itself (same reference) when nothing moves:
 * events already first or absent, or lifting it would leave home_2 and home_3
 * touching (events the only section between them). In that last case events
 * is the second of two sections, already near the top.
 */
export function phoneSequence(desktop: BelowFoldPiece[]): BelowFoldPiece[] {
  if (desktop.indexOf("events") <= 0) return desktop;
  const lifted: BelowFoldPiece[] = ["events", ...desktop.filter((p) => p !== "events")];
  return bannersTouch(lifted) ? desktop : lifted;
}

/** Two banners next to each other — the thing the banner rhythm exists to prevent. */
export const bannersTouch = (seq: BelowFoldPiece[]) =>
  seq.some((p, i) => isBanner(p) && i + 1 < seq.length && isBanner(seq[i + 1]));
const isBanner = (p: BelowFoldPiece) => p === "home_2" || p === "home_3";

/** Third and later cards of a row drop below sm — the phone page was ~7,000px (#33 C9). */
export const phoneCap = (i: number) => (i >= 2 ? "max-sm:hidden" : undefined);

/**
 * Banner width on a phone: a 370×280 mobile creative at full width was most
 * of a screen, three times over. Capped and centred as on the story page
 * (BlockRenderer's STORY_AD_WRAPPER); from md the desktop strip shows uncapped.
 */
export const HOME_AD_WRAPPER = "mx-auto w-full max-w-[300px] md:max-w-none";

/** The More News carousel's length, after the two fold highlights. */
const HOME_CAROUSEL_STORIES = 8;
/**
 * How far down `stories` the home page reaches: the two fold highlights plus
 * the carousel. Another design option's home view stops at the same story, so
 * the options show the same stories.
 */
export const HOME_TOP_STORIES = 2 + HOME_CAROUSEL_STORIES;

/**
 * Sold featured-member placements as the members to show, each once: a member
 * can hold overlapping placements, so they are deduplicated on slug. It
 * doubles as the null-member filter, since placements.member_id is nullable.
 */
export function uniqueFeaturedMembers<M extends { slug: string }>(placements: readonly { member: M | null }[]): M[] {
  return [...new Map(placements.flatMap((p) => (p.member ? [[p.member.slug, p.member] as const] : []))).values()];
}
