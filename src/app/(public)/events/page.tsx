import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { upcomingEvents } from "@/lib/queries";
import { excerptFromHtml } from "@/lib/sanitize";
import { AdSlot } from "@/components/AdSlot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

// date columns, not timestamps — format in UTC or they shift a day back west of Greenwich
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function EventsPage() {
  const [events, banners, showPlaceholders, ctx] = await Promise.all([
    upcomingEvents(20),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["events_mid"]);
  record([{ kind: "page_view", path: "/events", ...ctx }]);

  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Events</h1>
      <div className="mt-6 space-y-4">
        {events.slice(0, 3).map((e) => <EventCard key={e.slug} event={e} />)}
      </div>
      {events.length === 0 && <p className="text-gray-500">No upcoming events.</p>}
      {/* Unconditional: the slot is booked inventory, so it must not vanish just
          because the listing is short. Only the split below is count-dependent. */}
      <div className="my-6"><AdSlot slotKey="events_mid" adverts={slots.get("events_mid") ?? []} showPlaceholders={showPlaceholders} /></div>
      {events.length > 3 && (
        <div className="space-y-4">
          {events.slice(3).map((e) => <EventCard key={e.slug} event={e} />)}
        </div>
      )}
      <div className="my-10" />
    </div>
  );
}

function EventCard({ event }: { event: Awaited<ReturnType<typeof upcomingEvents>>[number] }) {
  const excerpt = excerptFromHtml(event.description);
  return (
    <div className="overflow-hidden rounded-lg bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase text-amber">
        {fmt(event.starts_on)}{event.ends_on && event.ends_on > event.starts_on && ` – ${fmt(event.ends_on)}`}
      </p>
      <h2 className="mt-1 text-lg font-bold">{event.title}</h2>
      {event.location && <p className="text-sm text-gray-500 break-words">{event.location}</p>}
      {excerpt && <p className="mt-2 text-sm text-gray-600">{excerpt}</p>}
      <div className="mt-2 flex gap-3 text-sm text-steel">
        {event.link && <a href={event.link} target="_blank" rel="noopener" className="hover:underline">Event website →</a>}
        {event.member && <span className="text-gray-500">Hosted by {event.member.name}</span>}
      </div>
    </div>
  );
}
