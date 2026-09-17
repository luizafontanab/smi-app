import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { EVENT_TYPE_LABELS, isEventType } from "@/lib/event-types";
import { breadcrumbLd, eventLd, stripTags } from "@/lib/jsonld";
import { eventBySlug } from "@/lib/queries";
import { JsonLd } from "@/components/JsonLd";
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
  const title = event?.title ?? "Event";
  const description = event?.description
    ? stripTags(event.description).slice(0, 160)
    : event
      ? `${event.title}${event.location ? ` — ${event.location}` : ""}, ${event.starts_on}.`
      : undefined;
  const cover = mediaUrl(event?.cover_path);
  return {
    title,
    description,
    alternates: { canonical: `/event/${slug}` },
    openGraph: { type: "website", url: `/event/${slug}`, title, description, images: cover ? [cover] : undefined },
    twitter: { card: "summary_large_image", title, description, images: cover ? [cover] : undefined },
  };
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
      <JsonLd
        data={[
          eventLd({ ...event, coverUrl: cover, memberName: event.member?.name }),
          breadcrumbLd([
            { name: "Events", path: "/event" },
            { name: event.title, path: `/event/${slug}` },
          ]),
        ]}
      />
      <Link href="/event" className="mt-6 inline-block text-sm text-graphite hover:text-ink">← All events</Link>

      {cover && (
        <div className="relative mt-3 h-64 overflow-hidden rounded-lg bg-graphite/10">
          <Image src={cover} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">
          {fmt(event.starts_on)}
          {event.ends_on && event.ends_on > event.starts_on && ` – ${fmt(event.ends_on)}`}
          {event.starts_time && `, ${fmtTime(event.starts_time)}`}
        </p>
        {event.type && isEventType(event.type) && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold uppercase text-brand-text">
            {EVENT_TYPE_LABELS[event.type]}
          </span>
        )}
      </div>
      <h1 className="mt-1 text-2xl font-bold text-ink">{event.title}</h1>
      {event.location && <p className="mt-1 text-sm text-graphite break-words">{event.location}</p>}

      {/* The page stays live after the date — these URLs were indexed for years
          on the old site. Say plainly that it has been and gone. */}
      {isPast && (
        <p className="mt-4 rounded border border-line bg-shade px-4 py-2 text-sm text-graphite">
          This event has already taken place.
        </p>
      )}

      {event.description && <RichText html={event.description} className="mt-4 text-ink" />}

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
