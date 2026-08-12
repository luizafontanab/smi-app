import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { activePlacements, headlineStory, publishedStories, publishedVideos, upcomingEvents } from "@/lib/queries";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { JoinCta } from "@/components/JoinCta";
import { Carousel, StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic"; // adverts re-roll on every page load

export default async function HomePage() {
  const [headline, { stories }, { stories: memberNews }, videos, events, placements, banners, logos, showPlaceholders, ctx] = await Promise.all([
    headlineStory(),
    publishedStories({ limit: 14 }),
    publishedStories({ limit: 4, memberOnly: true }),
    publishedVideos(6),
    upcomingEvents(3),
    activePlacements(),
    liveAdverts("banner"),
    liveAdverts("supplier_logo"),
    showAdPlaceholders(),
    requestContext(),
  ]);

  const slots = dealSlots(banners, ["home_1", "home_2", "home_3", "siderail_a", "siderail_b"]);
  const featuredMembers = placements.filter((p) => p.kind === "featured_member");
  const featuredMachine = placements.find((p) => p.kind === "featured_machine");
  const rest = stories.filter((s) => s.id !== headline?.id);

  // Advert impressions are NOT recorded here — the browser reports them once the
  // artwork has loaded and been on screen (components/AdCreative.tsx → /api/seen).
  record([{ kind: "page_view", path: "/", ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* Headline + side rail: news first, adverts beside it — never above it */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">{headline && <StoryCard story={headline} size="lg" />}</div>
        <aside className="flex flex-col gap-4">
          {featuredMembers[0]?.member && <FeaturedMemberCard member={featuredMembers[0].member} />}
          <AdSlot slotKey="siderail_a" adverts={slots.get("siderail_a") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
        </aside>
      </div>

      <Carousel title="Latest news" href="/news">
        {rest.slice(0, 8).map((s) => (
          <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} /></div>
        ))}
      </Carousel>

      <div className="mt-8"><AdSlot slotKey="home_1" adverts={slots.get("home_1") ?? []} showPlaceholders={showPlaceholders} /></div>

      {/* Rotating mixed grid — a bought block keeps its position for the paid period */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-navy">What&apos;s new. What&apos;s next</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {rest.slice(8, 14).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
          {videos.slice(0, 2).map((v) => <VideoCard key={v.id} video={v} />)}
          {memberNews.slice(0, 2).map((s) => <StoryCard key={`m-${s.id}`} story={s} size="sm" />)}
          {featuredMachine?.machine && <MachineCard machine={featuredMachine.machine} />}
          {featuredMembers[1]?.member && <FeaturedMemberCard member={featuredMembers[1].member} compact />}
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Carousel title="Latest videos" href="/videos">
            {videos.map((v) => (
              <div key={v.id} className="w-64 shrink-0"><VideoCard video={v} /></div>
            ))}
          </Carousel>
        </div>
        <aside className="mt-8 flex flex-col gap-4">
          <AdSlot slotKey="siderail_b" adverts={slots.get("siderail_b") ?? []} shape="rail" showPlaceholders={showPlaceholders} />
        </aside>
      </div>

      <div className="mt-8"><AdSlot slotKey="home_2" adverts={slots.get("home_2") ?? []} showPlaceholders={showPlaceholders} /></div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-navy">Events</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {events.map((e) => (
            <Link key={e.slug} href="/events" className="block h-full overflow-hidden rounded-lg bg-white p-4 shadow-sm transition hover:shadow-md">
              {/* starts_on is a date column — format in UTC or it shifts a day back west of Greenwich */}
              <p className="text-xs uppercase text-amber">{new Date(e.starts_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}</p>
              <p className="mt-1 font-semibold line-clamp-2">{e.title}</p>
              {e.location && <p className="mt-1 text-sm text-gray-500 line-clamp-2 break-words">{e.location}</p>}
            </Link>
          ))}
        </div>
      </section>

      <div className="my-8"><AdSlot slotKey="home_3" adverts={slots.get("home_3") ?? []} showPlaceholders={showPlaceholders} /></div>

      <div className="-mx-4"><SupplierLogos adverts={logos} showPlaceholders={showPlaceholders} /></div>

      <JoinCta />
    </div>
  );
}

function FeaturedMemberCard({ member, compact }: { member: { slug: string; name: string; logo_path: string | null; description: string | null; category?: { name: string } | null }; compact?: boolean }) {
  return (
    <Link href={`/members/${member.slug}`} className="relative block rounded-lg border-2 border-amber bg-white p-4 shadow-sm hover:shadow-md">
      <span className="absolute left-2 top-2 rounded bg-amber px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-navy">Featured member</span>
      <div className="mt-4 flex items-center gap-3">
        {member.logo_path && <Image src={mediaUrl(member.logo_path)!} alt="" width={48} height={48} className="rounded" unoptimized />}
        <div>
          <p className="font-bold">{member.name}</p>
          {member.category && <p className="text-xs text-gray-500">{member.category.name}</p>}
        </div>
      </div>
      {!compact && member.description && <p className="mt-2 text-sm text-gray-600 line-clamp-3">{member.description}</p>}
    </Link>
  );
}

function MachineCard({ machine }: { machine: { name: string; description: string | null; image_path: string | null; member?: { slug: string; name: string } | null } }) {
  return (
    <Link href="/featured-machine" className="relative block overflow-hidden rounded-lg border-2 border-steel bg-white shadow-sm hover:shadow-md">
      <span className="absolute left-2 top-2 z-10 rounded bg-steel px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Featured machine</span>
      <div className="relative h-32 bg-steel/10">
        {machine.image_path && <Image src={mediaUrl(machine.image_path)!} alt="" fill sizes="33vw" className="object-cover" unoptimized />}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold line-clamp-2">{machine.name}</p>
        {machine.member && <p className="mt-1 text-xs text-gray-500">{machine.member.name}</p>}
      </div>
    </Link>
  );
}

function VideoCard({ video }: { video: { id: string; title: string; url: string; member?: { name: string } | null } }) {
  const yt = video.url.match(/[?&]v=([\w-]+)/)?.[1];
  return (
    <a href={video.url} target="_blank" rel="noopener" className="group block overflow-hidden rounded-lg bg-white shadow-sm hover:shadow-md">
      <div className="relative h-32 bg-navy">
        {yt && <Image src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" fill sizes="33vw" className="object-cover opacity-80" unoptimized />}
        <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">▶</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold line-clamp-2">{video.title}</p>
        {video.member && <p className="mt-1 text-xs text-gray-500">{video.member.name}</p>}
      </div>
    </a>
  );
}
