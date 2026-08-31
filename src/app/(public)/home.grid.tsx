import Image from "next/image";
import Link from "next/link";
import { dealSlots } from "@/lib/adverts";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { EventCard, FeaturedMemberCard, MachineCard, VideoCard } from "@/components/cards";
import { HomeHero } from "@/components/HomeHero";
import { JoinCta } from "@/components/JoinCta";
import { MemberBadge, StoryCard } from "@/components/StoryCard";
import { excluding, type HomeData } from "./home.data";

/**
 * The grid home page: mixed vertical rails and horizontal bands, more content
 * types surfaced, and a wider spread of advert positions than forge carries.
 *
 * Commercial rules baked into the order below — these are requirements, not
 * taste (requirements/DESIGN-QUOTES.md §1, §7):
 *   · No advert above the fold. News first; the top slot is not for sale.
 *   · The first banner sits below the main stories, the others spread apart.
 *   · Rotation stays random-uniform. Nothing here reorders or filters by
 *     advertiser — dealSlots is called once and its order is used as given.
 *   · Member news is marked wherever it appears among industry news.
 *   · Videos are woven into the feed, not stacked in one band.
 */
export function GridHome({
  heroItems, stories, memberNews, videos, events, newsletters, directory,
  memberCount, categories, featuredMembers, featuredMachine, adverts, showPlaceholders,
}: HomeData) {
  // One call, this design's own positions. Grid reuses forge's key names where a
  // position is analogous (home_1/2/3) so impression reporting stays comparable,
  // and only invents keys for positions forge does not have.
  const banners = dealSlots(adverts.banner, ["home_1", "home_2", "home_3"]);
  const boxes = dealSlots(adverts.mpu, ["home_mpu_1", "home_mpu_2"]);
  const sky = dealSlots(adverts.skyscraper, ["home_sky"]);
  const inFeed = dealSlots(adverts.in_feed, ["home_infeed"]);

  // Compositional: grid's own counts. 5 in the lead column, 6 in the mixed grid.
  const lead = stories.slice(0, 5);
  const mixed = stories.slice(5, 11);
  const placed = new Set([...lead, ...mixed].map((s) => s.id));
  const railNews = excluding(memberNews, placed).slice(0, 4);

  return (
    <>
      {/* data-design scopes the shorter hero in globals.css. The hero component
          itself is untouched — only --hero-h moves. */}
      <div data-design="grid">
        {heroItems.length > 0 && <HomeHero items={heroItems} />}
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-12">
        {/* Jas asked for the search bar on home, news, video and members — one
            universal tool, and the query log is meant to steer SEO later. */}
        <form action="/search" className="mt-6 flex gap-2">
          <input
            name="q"
            type="search"
            aria-label="Search the site"
            placeholder="Search news, members, machines…"
            className="min-w-0 flex-1 rounded border border-line px-4 py-2.5 text-sm"
          />
          <button className="rounded bg-brand px-5 py-2.5 text-sm font-bold text-ink hover:brightness-110">Search</button>
        </form>

        {/* ── Lead: horizontal story rows left, vertical rail right ──────── */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section className="min-w-0">
            <SectionHead title="Latest news" href="/news" />
            <div className="divide-y divide-line border-t border-line">
              {lead.map((s) => <StoryRow key={s.id} story={s} />)}
            </div>
          </section>

          <aside className="flex flex-col gap-6">
            <section>
              <SectionHead title="Member news" href="/news?filter=members" />
              <ul className="space-y-3 border-t border-line pt-3">
                {railNews.map((s) => (
                  <li key={s.id}>
                    <Link href={`/news/${s.slug}`} className="group flex gap-3">
                      <span className="mt-0.5 h-10 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-snug line-clamp-2 group-hover:underline">{s.title}</span>
                        {s.member && <span className="mt-0.5 block text-xs text-graphite">{s.member.name}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
                {railNews.length === 0 && <li className="text-sm text-graphite">No member stories this week.</li>}
              </ul>
            </section>
            <AdSlot slotKey="home_mpu_1" adverts={boxes.get("home_mpu_1") ?? []} shape="mpu" showPlaceholders={showPlaceholders} />
          </aside>
        </div>

        {/* First advert on the page — below the main stories, per the brief. */}
        <div className="mt-10"><AdSlot slotKey="home_1" adverts={banners.get("home_1") ?? []} showPlaceholders={showPlaceholders} /></div>

        {/* ── The four-column mixed grid Jas asked for ───────────────────── */}
        <section className="mt-10">
          <SectionHead title="What's new. What's next" href="/news" />
          <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 lg:grid-cols-4">
            {mixed.slice(0, 4).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
            {videos.slice(0, 2).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
            {featuredMachine?.machine && <MachineCard machine={featuredMachine.machine} />}
            {featuredMembers[1]?.member && <FeaturedMemberCard member={featuredMembers[1].member} variant="compact" />}
            {/* Native slot: a sponsored card in the rhythm of the grid, labelled. */}
            <SponsoredCard slot={inFeed.get("home_infeed") ?? []} showPlaceholders={showPlaceholders} />
            {mixed.slice(4).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
          </div>
        </section>

        {/* ── Videos flanked by the skyscraper ───────────────────────────── */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_300px]">
          <section className="min-w-0">
            <SectionHead title="Watch" href="/video" />
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 md:grid-cols-3">
              {videos.slice(2, 8).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
            </div>
          </section>
          {/* sticky so the tall creative stays with the reader down a long column */}
          <aside className="hidden lg:block">
            <div className="sticky top-4">
              <AdSlot slotKey="home_sky" adverts={sky.get("home_sky") ?? []} shape="skyscraper" showPlaceholders={showPlaceholders} />
            </div>
          </aside>
        </div>

        {/* ── Events, four across ────────────────────────────────────────── */}
        <section className="mt-10">
          <SectionHead title="Events" href="/event" />
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
            {events.map((e) => <EventCard key={e.slug} event={e} size="sm" />)}
          </div>
        </section>

        <div className="mt-10"><AdSlot slotKey="home_2" adverts={banners.get("home_2") ?? []} showPlaceholders={showPlaceholders} /></div>

        {/* ── Magazine + newsletters: reachable only from the footer before ── */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section className="min-w-0">
            <SectionHead title="Newsletters &amp; magazine" href="/newsletters" />
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
              {newsletters.map((n) => (
                <Link key={n.web_slug} href={`/newsletters/${n.web_slug}`} className="group block rounded-lg border border-line p-4 hover:shadow-md">
                  <p className="text-xs font-bold uppercase tracking-widest text-brand">Issue {n.number}</p>
                  <p className="mt-1 font-semibold leading-snug line-clamp-3 group-hover:underline">{n.subject}</p>
                  {n.sent_at && (
                    <p className="mt-2 text-xs text-graphite">
                      {new Date(n.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </Link>
              ))}
              {newsletters.length === 0 && <p className="text-sm text-graphite">No issues sent yet.</p>}
            </div>
          </section>
          <aside>
            <AdSlot slotKey="home_mpu_2" adverts={boxes.get("home_mpu_2") ?? []} shape="mpu" showPlaceholders={showPlaceholders} />
          </aside>
        </div>

        {/* ── Member directory, logo-forward ─────────────────────────────── */}
        <section className="mt-10">
          <SectionHead title={`Members${memberCount ? ` · ${memberCount}` : ""}`} href="/member" />
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-4 sm:grid-cols-4 lg:grid-cols-6">
            {directory.map((m) => (
              <Link
                key={m.slug}
                href={`/member/${m.slug}`}
                title={m.name}
                className="flex h-20 items-center justify-center rounded-lg border border-line bg-white p-3 transition hover:shadow-md"
              >
                <Image src={mediaUrl(m.logo_path)!} alt={m.name} width={120} height={60} className="max-h-full w-auto object-contain" unoptimized />
              </Link>
            ))}
          </div>
        </section>

        {/* ── Browse by topic: the discoverability borrow ────────────────── */}
        {categories.length > 0 && (
          <section className="mt-10">
            <SectionHead title="Browse by topic" />
            <ul className="flex flex-wrap gap-2 border-t border-line pt-4">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/news?category=${c.slug}`}
                    className="inline-block rounded-full border border-line px-3 py-1.5 text-sm text-graphite transition hover:border-brand hover:text-ink"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10"><AdSlot slotKey="home_3" adverts={banners.get("home_3") ?? []} showPlaceholders={showPlaceholders} /></div>

        <div className="-mx-4 mt-10"><SupplierLogos adverts={adverts.supplier_logo} showPlaceholders={showPlaceholders} /></div>

        {featuredMembers[0]?.member && (
          <div className="mt-10"><FeaturedMemberCard member={featuredMembers[0].member} variant="band" /></div>
        )}

        <JoinCta />
      </div>
    </>
  );
}

function SectionHead({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-ink">
        <span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 translate-y-[1px] rounded-sm bg-brand" />
        {title}
      </h2>
      {href && <Link href={href} className="shrink-0 text-xs text-graphite hover:text-ink hover:underline">More →</Link>}
    </div>
  );
}

/** Horizontal row: image left, headline right — the shape a scannable lead column wants. */
function StoryRow({ story }: { story: HomeData["stories"][number] }) {
  const img = mediaUrl(story.cover_path);
  return (
    <Link href={`/news/${story.slug}`} className="group flex gap-4 py-4">
      <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded bg-graphite/10 sm:h-24 sm:w-40">
        {img
          ? <Image src={img} alt="" fill sizes="160px" style={focusStyle(story.cover_focus)} className="object-cover transition group-hover:scale-[1.03]" unoptimized />
          : <span className="flex h-full items-center justify-center text-2xl text-graphite/30">⚙</span>}
        {story.is_member_news && <MemberBadge />}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug line-clamp-2 group-hover:underline sm:text-lg">{story.title}</h3>
        {story.excerpt && <p className="mt-1 hidden text-sm text-graphite line-clamp-2 sm:block">{story.excerpt}</p>}
        <p className="mt-1.5 text-[11px] uppercase tracking-wide text-graphite">
          {story.published_at ? new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""}
          {story.member && <> · {story.member.name}</>}
        </p>
      </div>
    </Link>
  );
}

/**
 * In-feed advert. Labelled "Sponsored" because it borrows the shape of editorial
 * content — the label is what keeps that honest, and it is not optional.
 */
function SponsoredCard({ slot, showPlaceholders }: { slot: Parameters<typeof AdSlot>[0]["adverts"]; showPlaceholders: boolean }) {
  if (slot.length === 0 && !showPlaceholders) return null;
  return (
    <div className="rounded-lg border border-line p-2">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-graphite">Sponsored</p>
      <AdSlot slotKey="home_infeed" adverts={slot} shape="in_feed" showPlaceholders={showPlaceholders} />
    </div>
  );
}
