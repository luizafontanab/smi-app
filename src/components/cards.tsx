import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { EVENT_TYPE_LABELS, isEventType } from "@/lib/event-types";
import { youtubeId } from "@/lib/hero";
import { excerptFromHtml } from "@/lib/sanitize";
import { MemberBadge } from "@/components/StoryCard";

/**
 * Content cards shared by both site designs. They live here rather than beside
 * the page that first needed them because each design composes the same set at
 * different sizes — see src/components/StoryCard.tsx for the story equivalent,
 * whose `size` prop these follow.
 */

export type VideoCardData = {
  id: string;
  slug: string;
  title: string;
  url: string;
  thumbnail_path?: string | null;
  source?: string;
  member?: { name: string } | null;
};

const VIDEO_HEIGHTS = { sm: "h-32", md: "h-44" };
const PLAY_GLYPH = { sm: "text-3xl", md: "text-4xl" };

export function VideoCard({ video, size = "md" }: { video: VideoCardData; size?: "sm" | "md" }) {
  // thumbnail_path is the same still at a higher resolution in our own storage;
  // ytimg is the fallback for rows that lack one (everything synthetic-seeded).
  // lib/hero.ts:83-92 makes the same choice — keep the two in step.
  const yt = youtubeId(video.url);
  const img = mediaUrl(video.thumbnail_path ?? null) ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
  return (
    // Internal, not straight out to YouTube: /video/{slug} is a page we own and
    // can be linked to, indexed and advertised against. The embed is there.
    <Link href={`/video/${video.slug}`} className="group block overflow-hidden rounded-lg bg-white shadow-sm hover:shadow-md">
      <div className={`relative ${VIDEO_HEIGHTS[size]} bg-ink`}>
        {img && <Image src={img} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover opacity-80" unoptimized />}
        <span className={`absolute inset-0 flex items-center justify-center ${PLAY_GLYPH[size]} text-white drop-shadow`}>▶</span>
        {video.source === "member" && <MemberBadge label="Member video" />}
      </div>
      <div className="p-3">
        <p className={`font-semibold line-clamp-2 ${size === "sm" ? "text-sm" : ""}`}>{video.title}</p>
        {video.member && <p className="mt-1 text-xs text-graphite">{video.member.name}</p>}
      </div>
    </Link>
  );
}

export type FeaturedMemberData = {
  slug: string;
  name: string;
  logo_path: string | null;
  description: string | null;
  category?: { name: string } | null;
};

/**
 * "band" is the full-width bar under the hero, "card" the grid tile, "compact"
 * the tile without its description. One string rather than the old
 * `wide`/`compact` boolean pair, which let `{wide, compact}` be set together.
 */
export function FeaturedMemberCard({ member, variant = "card" }: { member: FeaturedMemberData; variant?: "band" | "card" | "compact" }) {
  if (variant === "band") {
    return (
      <Link href={`/member/${member.slug}`} className="group relative flex items-center gap-5 rounded-lg border-2 border-brand bg-white p-5 pt-8 shadow-sm transition hover:shadow-md sm:pt-5">
        <span className="absolute left-2 top-2 rounded bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">Featured member</span>
        {member.logo_path && (
          <Image src={mediaUrl(member.logo_path)!} alt="" width={72} height={72} className="hidden shrink-0 rounded sm:block" unoptimized />
        )}
        <div className="min-w-0">
          <p className="text-lg font-bold">{member.name}</p>
          {member.category && <p className="text-xs uppercase tracking-wide text-graphite">{member.category.name}</p>}
          {member.description && <p className="mt-1 text-sm text-graphite line-clamp-2">{member.description}</p>}
        </div>
        <span className="ml-auto hidden shrink-0 text-sm text-graphite group-hover:underline md:block">View member page →</span>
      </Link>
    );
  }
  return (
    <Link href={`/member/${member.slug}`} className="relative block rounded-lg border-2 border-brand bg-white p-4 shadow-sm hover:shadow-md">
      <span className="absolute left-2 top-2 rounded bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">Featured member</span>
      <div className="mt-4 flex items-center gap-3">
        {member.logo_path && <Image src={mediaUrl(member.logo_path)!} alt="" width={48} height={48} className="rounded" unoptimized />}
        <div>
          <p className="font-bold">{member.name}</p>
          {member.category && <p className="text-xs text-graphite">{member.category.name}</p>}
        </div>
      </div>
      {variant !== "compact" && member.description && <p className="mt-2 text-sm text-graphite line-clamp-3">{member.description}</p>}
    </Link>
  );
}

export type MemberTileData = {
  slug: string;
  name: string;
  logo_path: string | null;
  industry?: { name: string } | null;
};

const TILE_LOGO = { sm: { box: "h-20 w-20", px: 72 }, md: { box: "h-32 w-32", px: 112 } };

/**
 * Deliberately spare (fix list item 24): logo, name, industry — nothing else.
 * The whole card links to the member page, where description and contact
 * details live. Never emits a trailing slash: e2e selects a[href^='/member/'].
 *
 * "md" is the directory tile on /member and is byte-identical to the private
 * MemberCard it was lifted from, so that page's visual baseline does not move.
 * "sm" is the industry hub's. `showIndustry` is off there: every member on an
 * industry page shares the same one, so repeating it under each tile is noise.
 */
export function MemberTile({ member: m, size = "md", showIndustry = true }: {
  member: MemberTileData;
  size?: "sm" | "md";
  showIndustry?: boolean;
}) {
  const logo = TILE_LOGO[size];
  return (
    <Link href={`/member/${m.slug}`} className="block rounded-lg bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-4">
        {m.logo_path ? (
          // Rounded box bigger than the image inside it, so the corner radius
          // only ever clips white background, never a non-square logo's artwork.
          <div className={`flex ${logo.box} shrink-0 items-center justify-center rounded-lg bg-white`}>
            <Image src={mediaUrl(m.logo_path)!} alt="" width={logo.px} height={logo.px} className="object-contain" unoptimized />
          </div>
        ) : (
          <div className={`flex ${logo.box} shrink-0 items-center justify-center rounded-lg bg-graphite/10 text-3xl text-graphite/30`}>⚙</div>
        )}
        <div className="min-w-0">
          <p className="font-bold text-ink">{m.name}</p>
          {showIndustry && m.industry && <p className="text-xs text-graphite">{m.industry.name}</p>}
        </div>
      </div>
    </Link>
  );
}

export type EventCardData = {
  slug: string;
  title: string;
  location: string | null;
  starts_on: string;
  starts_time: string | null;
  ends_on: string | null;
  link: string | null;
  description: string | null;
  type?: string | null;
  member?: { slug: string; name: string } | null;
};

function EventTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type || !isEventType(type)) return null;
  return <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold uppercase text-brand-text">{EVENT_TYPE_LABELS[type]}</span>;
}

// starts_on/ends_on are date columns, not timestamps — format in UTC or they
// shift a day back west of Greenwich.
const eventDate = (d: string, withYear = true) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(withYear && { year: "numeric" }), timeZone: "UTC" });

// starts_time is a time column (HH:MM:SS) — parse as a plain wall-clock time,
// no timezone conversion.
const eventTime = (t: string) => {
  const [h, m] = t.split(":");
  return new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
};

/**
 * "md" is the listing card on /event — description, outbound links, host.
 * "sm" is the homepage tile. Both link to /event/{slug}: events have their own
 * detail route now, so neither has to fall back to the index or bounce the
 * reader straight off to the organiser's site.
 */
export function EventCard({ event, size = "md" }: { event: EventCardData; size?: "sm" | "md" }) {
  if (size === "sm") {
    return (
      <Link href={`/event/${event.slug}`} className="block h-full overflow-hidden rounded-lg bg-white p-4 shadow-sm transition hover:shadow-md">
        <div className="flex items-center gap-2">
          {/* graphite, not brand: small orange text on white is 3.3:1 — the
              exact pairing globals.css forbids for body-size text */}
          <p className="text-xs font-semibold uppercase text-graphite">{eventDate(event.starts_on, false)}</p>
          <EventTypeBadge type={event.type} />
        </div>
        <p className="mt-1 font-semibold line-clamp-2">{event.title}</p>
        {event.location && <p className="mt-1 text-sm text-graphite line-clamp-2 break-words">{event.location}</p>}
      </Link>
    );
  }
  const excerpt = excerptFromHtml(event.description);
  return (
    <div className="overflow-hidden rounded-lg bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase text-graphite">
          {eventDate(event.starts_on)}{event.ends_on && event.ends_on > event.starts_on && ` – ${eventDate(event.ends_on)}`}
          {event.starts_time && `, ${eventTime(event.starts_time)}`}
        </p>
        <EventTypeBadge type={event.type} />
      </div>
      <h2 className="mt-1 text-lg font-bold">
        <Link href={`/event/${event.slug}`} className="hover:text-graphite">{event.title}</Link>
      </h2>
      {event.location && <p className="text-sm text-graphite break-words">{event.location}</p>}
      {excerpt && <p className="mt-2 text-sm text-graphite">{excerpt}</p>}
      <div className="mt-2 flex gap-3 text-sm text-graphite">
        <Link href={`/event/${event.slug}`} className="hover:underline">Details →</Link>
        {event.link && <a href={event.link} target="_blank" rel="noopener" className="hover:underline">Event website →</a>}
        {event.member && <span className="text-graphite">Hosted by {event.member.name}</span>}
      </div>
    </div>
  );
}

export type MachineCardData = {
  name: string;
  description: string | null;
  image_path: string | null;
  member?: { slug: string; name: string } | null;
};

export function MachineCard({ machine }: { machine: MachineCardData }) {
  return (
    <Link href="/featured-machine" className="relative block overflow-hidden rounded-lg border-2 border-graphite bg-white shadow-sm hover:shadow-md">
      <span className="absolute left-2 top-2 z-10 rounded bg-graphite px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Featured machine</span>
      <div className="relative h-32 bg-graphite/10">
        {machine.image_path && <Image src={mediaUrl(machine.image_path)!} alt="" fill sizes="33vw" className="object-cover" unoptimized />}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold line-clamp-2">{machine.name}</p>
        {machine.member && <p className="mt-1 text-xs text-graphite">{machine.member.name}</p>}
      </div>
    </Link>
  );
}
