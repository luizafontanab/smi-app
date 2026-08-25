import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { pastEvents, upcomingEvents } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { EventCard } from "@/components/cards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

// `date` columns, not timestamps — force UTC or they shift a day back west of
// Greenwich. Short form here; the cards use the long one.
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function EventsPage() {
  const [events, past, banners, showPlaceholders, ctx] = await Promise.all([
    upcomingEvents(20),
    pastEvents(40),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["events_mid"]);
  record([{ kind: "page_view", path: "/event", ...ctx }]);

  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Events</h1>
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

      {/* Past events keep their pages — the old site's /event/ URLs were indexed
          for years, and listing only what is upcoming quietly retired each one
          the morning after its date. A compact list, not cards: this is an
          archive people arrive at from a search result, not a browse surface. */}
      {past.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold text-ink">Past events</h2>
          <ul className="mt-3 divide-y rounded-lg bg-white shadow-sm">
            {past.map((e) => (
              <li key={e.slug} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
                <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-gray-400">{fmt(e.starts_on)}</span>
                <Link href={`/event/${e.slug}`} className="font-medium hover:text-graphite">{e.title}</Link>
                {e.location && <span className="text-sm text-gray-500 break-words">{e.location}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="my-10" />
    </div>
  );
}
