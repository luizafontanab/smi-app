import { dealSlots } from "@/lib/adverts";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { EventCard, FeaturedMemberCard, MachineCard, VideoCard } from "@/components/cards";
import { HomeHero } from "@/components/HomeHero";
import { JoinCta } from "@/components/JoinCta";
import { SearchForm } from "@/components/SearchForm";
import { Carousel, StoryCard } from "@/components/StoryCard";
import { excluding, type HomeData } from "./home.data";

/**
 * The forge home page. Pure composition: no queries, no analytics, no cookies —
 * everything it renders arrives as props from home.data.ts. Keeping views free
 * of data access is what stops the two designs drifting into two pipelines.
 */
export function ForgeHome({
  heroItems, stories, memberNews, videos, events,
  featuredMembers, featuredMachine, adverts, showPlaceholders,
}: HomeData) {
  // siderail_a is gone: the hero is full-bleed, so there is no column beside it
  // for a rail advert to live in. Slot keys are positional labels only — no
  // booking references one — so dropping it costs no data, but this design
  // carries four sellable positions rather than five.
  //
  // Called exactly once per render: dealSlots deals from one shuffle, so a
  // second call could hand the same advert to a second position on this page.
  const slots = dealSlots(adverts.banner, ["home_1", "home_2", "home_3", "siderail_b"]);

  // Compositional, not invariant: "the first 14" is this design's carousel-plus-
  // grid count. Grid places different numbers and computes its own.
  const placed = new Set(stories.slice(0, 14).map((s) => s.id));

  return (
    <>
      {/* Full-bleed: a sibling of the max-w-6xl column, not inside it. The public
          layout's <main> imposes no width, so this spans the viewport without a
          100vw hack (which would overflow by the scrollbar width). */}
      {/* The page's only h1 lives inside HomeHero (sr-only) — when there is
          nothing to put in the hero, keep the heading so the page never ships
          without one. */}
      {heroItems.length > 0
        ? <HomeHero items={heroItems} />
        : <h1 className="sr-only">Sheet Metal Industries — news for UK sheet metal, fabrication and welding</h1>}

      <div className="mx-auto max-w-6xl px-4">
      {/* Jas asked for the search bar on home, news, video and members — one
          universal tool, and the query log is meant to steer SEO later. */}
      <SearchForm />

      {/* The band that used to sit beside the headline. No advert here — the
          first one on the page is now home_1, below the news carousel. */}
      {featuredMembers[0]?.member && (
        <div className="mt-8"><FeaturedMemberCard member={featuredMembers[0].member} variant="band" /></div>
      )}

      <Carousel title="Latest news" href="/news">
        {stories.slice(0, 8).map((s) => (
          <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} /></div>
        ))}
      </Carousel>

      <div className="mt-8"><AdSlot slotKey="home_1" adverts={slots.get("home_1") ?? []} showPlaceholders={showPlaceholders} /></div>

      {/* Rotating mixed grid — a bought block keeps its position for the paid period */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">What&apos;s new. What&apos;s next</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {stories.slice(8, 14).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
          {videos.slice(0, 2).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
          {excluding(memberNews, placed).slice(0, 2).map((s) => <StoryCard key={`m-${s.id}`} story={s} size="sm" />)}
          {featuredMachine?.machine && <MachineCard machine={featuredMachine.machine} />}
          {featuredMembers[1]?.member && <FeaturedMemberCard member={featuredMembers[1].member} variant="compact" />}
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* min-w-0: a grid item defaults to min-width:auto, so without this the
            carousel's fixed-width cards widen the whole page on mobile. */}
        <div className="min-w-0 lg:col-span-2">
          <Carousel title="Latest videos" href="/video">
            {videos.slice(2, 8).map((v) => (
              <div key={v.id} className="w-64 shrink-0"><VideoCard video={v} size="sm" /></div>
            ))}
          </Carousel>
        </div>
        <aside className="mt-8 flex flex-col gap-4">
          <AdSlot slotKey="siderail_b" adverts={slots.get("siderail_b") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
        </aside>
      </div>

      <div className="mt-8"><AdSlot slotKey="home_2" adverts={slots.get("home_2") ?? []} showPlaceholders={showPlaceholders} /></div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">Events</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {events.map((e) => <EventCard key={e.slug} event={e} size="sm" />)}
        </div>
      </section>

      <div className="my-8"><AdSlot slotKey="home_3" adverts={slots.get("home_3") ?? []} showPlaceholders={showPlaceholders} /></div>

      <div className="-mx-4"><SupplierLogos adverts={adverts.supplier_logo} showPlaceholders={showPlaceholders} /></div>

      <JoinCta />
      </div>
    </>
  );
}
