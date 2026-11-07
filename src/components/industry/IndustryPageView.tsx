import Link from "next/link";
import type { IndustryHub } from "@/lib/industry-hub";
import { Carousel, StoryCard } from "@/components/StoryCard";
import { EventCard, MemberTile, VideoCard } from "@/components/cards";

/**
 * Every row is a Carousel, so a card's width has to be fixed — the scroller is
 * a flex row, and an auto-width card would collapse to its content. w-64 is the
 * width the newsroom's rails already use; keep the four in step.
 */
const CARD = "w-64 shrink-0";

/**
 * Current's /industry/[slug] body. The route loads the hub and renders this
 * through the design-option hook point (src/components/design-option.ts).
 */
export function IndustryPageView({ slug, hub }: {
  slug: string;
  hub: IndustryHub;
  /**
   * Every public industry, in sort order. Passed by the route for a design
   * option with a topic switcher (Classic, #76); Current doesn't use it.
   */
  industries?: { slug: string; name: string }[];
}) {
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
    <div data-part="industry-page" className="mx-auto max-w-6xl px-4">
      <h1 data-part="page-title" className="mt-6 text-2xl font-bold text-ink">{industry.name}</h1>
      {/* Always rendered, even for an industry with nothing tagged to it yet:
          two working exits beat a dead end. */}
      <p data-part="page-intro" className="mt-1 text-sm text-graphite">
        {summary && <>{summary} · </>}
        <Link href={newsHref} className="underline hover:no-underline">All news</Link>
        {" · "}
        <Link href={memberHref} className="underline hover:no-underline">All members</Link>
      </p>

      {isEmpty && (
        <p data-part="empty-state" className="mt-10 rounded-lg bg-white p-6 text-center text-graphite shadow-sm">
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
