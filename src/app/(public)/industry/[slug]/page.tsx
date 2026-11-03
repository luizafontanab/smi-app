import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { industryBySlug } from "@/lib/queries";
import { Carousel, StoryCard } from "@/components/StoryCard";
import { EventCard, MemberTile, VideoCard } from "@/components/cards";
import { loadIndustryHub } from "./hub.data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  if (!(await isFeatureEnabled("industries_public"))) return {};
  // cache()d, so this costs nothing on top of the page body's own lookup.
  const ind = await industryBySlug(slug);
  return {
    title: ind ? ind.name : "Industry",
    description: ind ? `News, members, videos and events from the UK ${ind.name.toLowerCase()} industry.` : undefined,
    alternates: { canonical: `/industry/${slug}` },
  };
}

/**
 * Every row is a Carousel, so a card's width has to be fixed — the scroller is
 * a flex row, and an auto-width card would collapse to its content. w-64 is the
 * width the newsroom's rails already use; keep the four in step.
 */
const CARD = "w-64 shrink-0";

export default async function IndustryPage(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  // Industries hidden from the public (flag industries_public): an old link —
  // a bookmark, a search result — lands on News instead of an error. redirect()
  // is a 307, so nothing is cached as permanent and turning the flag back on
  // restores the page.
  if (!(await isFeatureEnabled("industries_public"))) redirect("/news");
  const hub = await loadIndustryHub(slug);
  if (!hub) notFound();
  const { industry, stories, storyTotal, members, memberTotal, videos, videoTotal, events, eventTotal, eventsTense } = hub;

  const newsHref = `/news?industry=${slug}`;
  const memberHref = `/member?industry=${slug}`;
  // Counts with zeros omitted — "0 videos" is noise on a page that already
  // omits the empty section itself.
  const counts = [
    [storyTotal, "story", "stories"],
    [memberTotal, "member", "members"],
    [videoTotal, "video", "videos"],
    [eventTotal, "event", "events"],
  ] as const;
  const summary = counts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(" · ");
  const isEmpty = stories.length === 0 && members.length === 0 && videos.length === 0 && events.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">{industry.name}</h1>
      {/* Always rendered, even for an industry with nothing tagged to it yet:
          two working exits beat a dead end. */}
      <p className="mt-1 text-sm text-graphite">
        {summary && <>{summary} · </>}
        <Link href={newsHref} className="underline hover:no-underline">All news</Link>
        {" · "}
        <Link href={memberHref} className="underline hover:no-underline">All members</Link>
      </p>

      {isEmpty && (
        <p className="mt-10 rounded-lg bg-white p-6 text-center text-graphite shadow-sm">
          Nothing is tagged {industry.name} yet.
        </p>
      )}

      {stories.length > 0 && (
        <Carousel title="News" href={newsHref}>
          {stories.map((s) => <div key={s.id} className={CARD}><StoryCard story={s} showExcerpt={false} /></div>)}
        </Carousel>
      )}

      {members.length > 0 && (
        <Carousel title="Members" href={memberHref}>
          {members.map((m) => <div key={m.slug} className={CARD}><MemberTile member={m} size="sm" showIndustry={false} /></div>)}
        </Carousel>
      )}

      {videos.length > 0 && (
        <Carousel title="Videos" href={`/video?industry=${slug}`}>
          {videos.map((v) => <div key={v.id} className={CARD}><VideoCard video={v} /></div>)}
        </Carousel>
      )}

      {events.length > 0 && (
        <Carousel title={eventsTense === "upcoming" ? "Upcoming events" : "Past events"} href={`/event?industry=${slug}`}>
          {events.map((e) => <div key={e.slug} className={CARD}><EventCard event={e} size="sm" /></div>)}
        </Carousel>
      )}

      <div className="my-10" />
    </div>
  );
}
