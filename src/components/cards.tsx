import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { youtubeId } from "@/lib/hero";
import { excerptFromHtml } from "@/lib/sanitize";

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
      </div>
      <div className="p-3">
        <p className={`font-semibold line-clamp-2 ${size === "sm" ? "text-sm" : ""}`}>{video.title}</p>
        {video.member && <p className="mt-1 text-xs text-gray-500">{video.member.name}</p>}
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
          {member.category && <p className="text-xs uppercase tracking-wide text-gray-500">{member.category.name}</p>}
          {member.description && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{member.description}</p>}
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
          {member.category && <p className="text-xs text-gray-500">{member.category.name}</p>}
        </div>
      </div>
      {variant !== "compact" && member.description && <p className="mt-2 text-sm text-gray-600 line-clamp-3">{member.description}</p>}
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
  member?: { slug: string; name: string } | null;
};

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
        <p className="text-xs uppercase text-brand">{eventDate(event.starts_on, false)}</p>
        <p className="mt-1 font-semibold line-clamp-2">{event.title}</p>
        {event.location && <p className="mt-1 text-sm text-gray-500 line-clamp-2 break-words">{event.location}</p>}
      </Link>
    );
  }
  const excerpt = excerptFromHtml(event.description);
  return (
    <div className="overflow-hidden rounded-lg bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase text-brand">
        {eventDate(event.starts_on)}{event.ends_on && event.ends_on > event.starts_on && ` – ${eventDate(event.ends_on)}`}
        {event.starts_time && `, ${eventTime(event.starts_time)}`}
      </p>
      <h2 className="mt-1 text-lg font-bold">
        <Link href={`/event/${event.slug}`} className="hover:text-graphite">{event.title}</Link>
      </h2>
      {event.location && <p className="text-sm text-gray-500 break-words">{event.location}</p>}
      {excerpt && <p className="mt-2 text-sm text-gray-600">{excerpt}</p>}
      <div className="mt-2 flex gap-3 text-sm text-graphite">
        <Link href={`/event/${event.slug}`} className="hover:underline">Details →</Link>
        {event.link && <a href={event.link} target="_blank" rel="noopener" className="hover:underline">Event website →</a>}
        {event.member && <span className="text-gray-500">Hosted by {event.member.name}</span>}
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
        {machine.member && <p className="mt-1 text-xs text-gray-500">{machine.member.name}</p>}
      </div>
    </Link>
  );
}
