import type { IndustryHub } from "@/lib/industry-hub";
import { StoryCard } from "@/components/StoryCard";
import { EventCard, MemberTile, VideoCard } from "@/components/cards";
import { ClassicIndustryBody, type IndustrySection } from "@/components/classic/ClassicIndustryBody";

/**
 * Classic's industry page body, the "Topic page" (hook point `IndustryView` in
 * src/components/design-option.ts; spec #68, ticket #76). Same props as
 * Current's IndustryPageView, including the route's industry list, which only
 * Classic uses (for the Topics select).
 *
 *   · A large title with an orange disc (classic.css #76).
 *   · Sort By and Topics selects. Topics goes to another industry's page;
 *     Sort By reorders the cards in place (ClassicIndustryBody).
 *   · One white panel each for news, members, videos and events, cards four
 *     across. A section with no entries is left out.
 *   · Each section ends with a blue "See all …" button, whether or not there
 *     is more to see: it is also the way into that list's filters.
 *   · The cards are the SHARED ones (components/StoryCard.tsx,
 *     components/cards.tsx), styled by the cards ticket (#75). This module
 *     renders them and only lays them out.
 */
export function ClassicIndustryView({ slug, hub, industries = [] }: {
  slug: string;
  hub: IndustryHub;
  industries?: { slug: string; name: string }[];
}) {
  const { industry, stories, members, videos, events, eventsTense } = hub;

  const sections: IndustrySection[] = [
    {
      id: "news", title: "News", seeAll: { href: `/news?industry=${slug}`, label: "See all news" },
      items: stories.slice(0, LIMIT.news).map((s) => ({ key: s.id, name: s.title, card: <StoryCard story={s} showExcerpt={false} /> })),
    },
    {
      id: "members", title: "Members", seeAll: { href: `/member?industry=${slug}`, label: "See all members" },
      items: members.slice(0, LIMIT.members).map((m) => ({ key: m.slug, name: m.name, card: <MemberTile member={m} size="sm" showIndustry={false} /> })),
    },
    {
      id: "videos", title: "Videos", seeAll: { href: `/video?industry=${slug}`, label: "See all videos" },
      items: videos.slice(0, LIMIT.videos).map((v) => ({ key: v.id, name: v.title, card: <VideoCard video={v} /> })),
    },
    {
      id: "events", title: eventsTense === "upcoming" ? "Upcoming events" : "Past events",
      seeAll: { href: `/event?industry=${slug}`, label: "See all events" },
      items: events.slice(0, LIMIT.events).map((e) => ({ key: e.slug, name: e.title, card: <EventCard event={e} size="sm" /> })),
    },
  ];

  return (
    <div data-part="industry-page">
      <h1 data-part="page-title">{industry.name}</h1>
      <ClassicIndustryBody
        sections={sections.filter((s) => s.items.length > 0)}
        topics={industries}
        current={{ slug, name: industry.name }}
        emptyText={`Nothing is tagged ${industry.name} yet.`}
      />
    </div>
  );
}

/**
 * How many of each the page shows: two rows of four for news and members, one
 * row for videos and events (prototype A2). The hub loads ten of each for
 * Current's carousels; ten would leave a ragged third row here. Sort By sorts
 * these, so A–Z never swaps in older entries the page didn't show before.
 */
const LIMIT = { news: 8, members: 8, videos: 4, events: 4 } as const;
