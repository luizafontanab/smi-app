import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { eventBySlug } from "@/lib/queries";
import { RichText } from "@/components/RichText";
import { ShareButtons } from "@/components/ShareButtons";

export const dynamic = "force-dynamic";

// date columns, not timestamps — format in UTC or they shift a day back west of
// Greenwich. Same helper shape as the listing; keep the two in step.
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// starts_time is a time column (HH:MM:SS) — parse as a plain wall-clock time,
// no timezone conversion.
const fmtTime = (t: string) => new Date(2000, 0, 1, Number(t.split(":")[0]), Number(t.split(":")[1])).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });

export async function generateMetadata(props: PageProps<"/event/[slug]">) {
  const { slug } = await props.params;
  const event = await eventBySlug(slug);
  return { title: event?.title ?? "Event" };
}

export default async function EventPage(props: PageProps<"/event/[slug]">) {
  const { slug } = await props.params;
  const [event, ctx] = await Promise.all([eventBySlug(slug), requestContext()]);
  if (!event) notFound();
  record([{ kind: "page_view", path: `/event/${slug}`, ...ctx }]);

  const cover = mediaUrl(event.cover_path);
  const isPast = event.starts_on < new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl px-4">
      <Link href="/event" className="mt-6 inline-block text-sm text-gray-400 hover:text-ink">← All events</Link>

      {cover && (
        <div className="relative mt-3 h-64 overflow-hidden rounded-lg bg-graphite/10">
          <Image src={cover} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        </div>
      )}

      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-brand">
        {fmt(event.starts_on)}
        {event.ends_on && event.ends_on > event.starts_on && ` – ${fmt(event.ends_on)}`}
        {event.starts_time && `, ${fmtTime(event.starts_time)}`}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-ink">{event.title}</h1>
      {event.location && <p className="mt-1 text-sm text-gray-500 break-words">{event.location}</p>}

      {/* The page stays live after the date — these URLs were indexed for years
          on the old site. Say plainly that it has been and gone. */}
      {isPast && (
        <p className="mt-4 rounded border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
          This event has already taken place.
        </p>
      )}

      {event.description && <RichText html={event.description} className="mt-4 text-gray-700" />}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {event.link && (
          <a href={event.link} target="_blank" rel="noopener" className="rounded bg-ink px-5 py-2.5 text-sm text-white">
            Event website →
          </a>
        )}
        {event.member && (
          <Link href={`/member/${event.member.slug}`} className="rounded border px-5 py-2.5 text-sm">
            Hosted by {event.member.name}
          </Link>
        )}
      </div>

      <ShareButtons />
      <div className="my-10" />
    </div>
  );
}
