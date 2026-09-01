import Image from "next/image";
import Link from "next/link";
import { dealSlots } from "@/lib/adverts";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { FeaturedMemberCard, MachineCard, VideoCard } from "@/components/cards";
import { JoinCta } from "@/components/JoinCta";
import { SearchForm } from "@/components/SearchForm";
import { MemberBadge, StoryCard } from "@/components/StoryCard";
import { excluding, type HomeData } from "./home.data";

/**
 * The grid home page: a 12-column rail/rail composition up top (rotating
 * banner, member/logo/video rail, headline story, media block, ad/machine
 * rail), then two mixed-content rows, a content spotlight and a closing ad —
 * built from the 2026-09 homepage wireframe. No HomeHero here; the rotating
 * banner in that slot is a real, sold advert placement (home_1) rather than
 * an editorial hero, a deliberate exception to the usual no-ad-above-the-fold
 * stance (requirements/DESIGN-QUOTES.md §1) made for this design.
 *
 * Commercial rules still in force (requirements/DESIGN-QUOTES.md §7):
 *   · Rotation stays random-uniform — dealSlots is called once per slot
 *     family and its order used as given, never reordered or filtered.
 *   · Member news is marked wherever it appears among industry news
 *     (StoryCard does this itself off `is_member_news`).
 */
export function GridHome({
  stories, memberNews, videos, featuredMembers, featuredMachine, adverts, showPlaceholders,
}: HomeData) {
  // One call per slot family. home_1/2/3 match forge's banner key names so
  // impression reporting stays comparable across designs.
  const banners = dealSlots(adverts.banner, ["home_1", "home_2", "home_3"]);
  const boxes = dealSlots(adverts.mpu, ["home_mpu_1"]);
  const railLogoKeys = Array.from({ length: 8 }, (_, i) => `home_rail_${i + 1}`);
  const railLogos = dealSlots(adverts.supplier_logo, railLogoKeys, 1);

  // Compositional slicing: lead story + 2 secondary rows, a content spotlight,
  // and a small pool for the two mixed rails — all disjoint so nothing repeats.
  const [lead, ...rest] = stories;
  const secondary = rest.slice(0, 2);
  const spotlight = rest[2];
  const mixedNews = rest.slice(3, 5);
  const placedStoryIds = new Set([lead, ...secondary, spotlight, ...mixedNews].filter(Boolean).map((s) => s!.id));
  const railNews = excluding(memberNews, placedStoryIds);
  const member1 = featuredMembers[0]?.member;
  const member2 = (featuredMembers[1] ?? featuredMembers[0])?.member;
  const machine = featuredMachine?.machine;

  const trending = [
    mixedNews[0] && { type: "News", label: mixedNews[0].title, href: `/news/${mixedNews[0].slug}` },
    videos[6] && { type: "Video", label: videos[6].title, href: "/video" },
    machine && { type: "Machine", label: machine.name, href: `/member/${machine.member.slug}` },
    railNews[0] && { type: "Member", label: railNews[0].title, href: `/news/${railNews[0].slug}` },
  ].filter((item): item is { type: string; label: string; href: string } => Boolean(item));

  const forYou = [
    mixedNews[1] && { type: "News", label: mixedNews[1].title, href: `/news/${mixedNews[1].slug}` },
    videos[7] && { type: "Video", label: videos[7].title, href: "/video" },
    member2 && { type: "Member", label: member2.name, href: `/member/${member2.slug}` },
  ].filter((item): item is { type: string; label: string; href: string } => Boolean(item));

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pb-12">
        {/* The rotating banner is a real advert slot, not an editorial hero —
            see the top-of-file note on the above-the-fold exception. */}
        <div className="pt-6"><AdSlot slotKey="home_1" adverts={banners.get("home_1") ?? []} showPlaceholders={showPlaceholders} /></div>

        {/* Jas asked for the search bar on home, news, video and members — one
            universal tool, and the query log is meant to steer SEO later. */}
        <SearchForm />

        {/* ── Lead: horizontal story rows left, vertical rail right ──────── */}
        {/* ── Rail / headline story / media block / rail ──────────────────── */}
        <div className="mt-8 grid gap-5 lg:grid-cols-[2fr_4fr_4fr_2fr]">
          <div className="flex flex-col gap-4">
            {member1 && <FeaturedMemberCard member={member1} variant="compact" />}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <AdSlot slotKey="home_rail_1" adverts={railLogos.get("home_rail_1") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
              <AdSlot slotKey="home_rail_2" adverts={railLogos.get("home_rail_2") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
            </div>
            {videos.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-graphite">Latest videos</p>
                <div className="flex flex-col gap-2">
                  {videos.slice(0, 2).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <AdSlot slotKey="home_rail_3" adverts={railLogos.get("home_rail_3") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
              <AdSlot slotKey="home_rail_4" adverts={railLogos.get("home_rail_4") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
            </div>
          </div>

          <div className="min-w-0">
            <SectionHead title="Latest news" href="/news" />
            {lead && <StoryCard story={lead} size="lg" />}
            <div className="divide-y divide-line border-t border-line">
              {secondary.map((s) => <StoryRow key={s.id} story={s} />)}
            </div>
          </div>

          <div className="min-w-0">
            <SectionHead title="Watch" href="/video" />
            {videos[2] && <VideoCard video={videos[2]} size="md" />}
            {videos.length > 3 && (
              <>
                <p className="mb-2 mt-3 text-[10px] font-bold uppercase tracking-widest text-graphite">More in this series</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {videos.slice(3, 5).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <AdSlot slotKey="home_rail_5" adverts={railLogos.get("home_rail_5") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
              <AdSlot slotKey="home_rail_6" adverts={railLogos.get("home_rail_6") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
            </div>
            <AdSlot slotKey="home_mpu_1" adverts={boxes.get("home_mpu_1") ?? []} shape="mpu" showPlaceholders={showPlaceholders} />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <AdSlot slotKey="home_rail_7" adverts={railLogos.get("home_rail_7") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
              <AdSlot slotKey="home_rail_8" adverts={railLogos.get("home_rail_8") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
            </div>
            {machine && <MachineCard machine={machine} />}
          </div>
        </div>

        <div className="mt-10"><AdSlot slotKey="home_2" adverts={banners.get("home_2") ?? []} showPlaceholders={showPlaceholders} /></div>

        {/* ── Watch more: three video cards + a mixed trending rail ───────── */}
        <section className="mt-10">
          <SectionHead title="Watch more" href="/video" />
          <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 lg:grid-cols-4">
            {videos.slice(5, 8).map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
            <MixedRail title="Trending now" items={trending} />
          </div>
        </section>

        {/* ── For you: mixed rail + member news + a media pick ────────────── */}
        <section className="mt-10">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MixedRail title="For you" items={forYou} />
            {railNews.slice(0, 2).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
            {videos[8] && <VideoCard video={videos[8]} size="sm" />}
          </div>
        </section>

        {/* ── Content spotlight ────────────────────────────────────────────── */}
        {spotlight && (
          <section className="mt-10 max-w-lg">
            <SectionHead title="Industry insight" />
            <StoryCard story={spotlight} size="lg" />
          </section>
        )}

        <div className="mt-10"><AdSlot slotKey="home_3" adverts={banners.get("home_3") ?? []} showPlaceholders={showPlaceholders} /></div>

        <div className="-mx-4 mt-10"><SupplierLogos adverts={adverts.supplier_logo} showPlaceholders={showPlaceholders} /></div>

        {member2 && <div className="mt-10"><FeaturedMemberCard member={member2} variant="band" /></div>}

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

type MixedRailItem = { type: string; label: string; href: string };

const MIXED_RAIL_CHIP: Record<string, string> = {
  News: "bg-ink/8 text-ink",
  Video: "bg-brand/10 text-brand",
  Machine: "bg-graphite/10 text-graphite",
  Member: "bg-gold/15 text-ink",
};

/** A short rail of differently-typed content, each row tagged by kind. */
function MixedRail({ title, items }: { title: string; items: MixedRailItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-graphite">{title}</p>
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <Link key={i} href={item.href} className="group flex items-center gap-2">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${MIXED_RAIL_CHIP[item.type] ?? "bg-graphite/10 text-graphite"}`}>
              {item.type}
            </span>
            <span className="min-w-0 truncate text-xs font-semibold group-hover:underline">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
