import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { dayKey, monthGrid, parseMonth } from "@/lib/calendar";
import { EVENT_TYPES, EVENT_TYPE_LABELS, isEventType } from "@/lib/event-types";
import { eventsInRange, pastEvents, upcomingEventPins, upcomingEvents } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { Pagination } from "@/components/Pagination";
import { EventCard } from "@/components/cards";
import { EventsCalendar } from "./EventsCalendar";
import { EventMap } from "./EventMap";

export const dynamic = "force-dynamic";
const PAGE_SIZE_UPCOMING = 12;
const PAGE_SIZE_PAST = 20;

export const metadata = {
  title: "Events",
  description: "Trade shows, open houses and industry events for the UK sheet metal, fabrication and welding community.",
  alternates: { canonical: "/event" },
};

// `date` columns, not timestamps — force UTC or they shift a day back west of
// Greenwich. Short form here; the cards use the long one.
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function EventsPage(props: PageProps<"/event">) {
  const sp = await props.searchParams;
  const upcomingPage = Math.max(1, Number(sp.upcoming_page) || 1);
  const pastPage = Math.max(1, Number(sp.past_page) || 1);
  const type = typeof sp.type === "string" && isEventType(sp.type) ? sp.type : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  // Only a well-formed month is worth carrying in links; parseMonth already
  // falls back to the current month for anything else.
  const monthParam = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : undefined;
  const month = parseMonth(monthParam);
  const grid = monthGrid(month);

  const [{ events, total: upcomingTotal }, { events: past, total: pastTotal }, monthEvents, pins, banners, showPlaceholders, ctx] = await Promise.all([
    upcomingEvents({ limit: PAGE_SIZE_UPCOMING, offset: (upcomingPage - 1) * PAGE_SIZE_UPCOMING, type, q }),
    pastEvents({ limit: PAGE_SIZE_PAST, offset: (pastPage - 1) * PAGE_SIZE_PAST }),
    eventsInRange(dayKey(grid.start), dayKey(grid.end)),
    upcomingEventPins(),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["events_mid"]);
  const upcomingPages = Math.max(1, Math.ceil(upcomingTotal / PAGE_SIZE_UPCOMING));
  const pastPages = Math.max(1, Math.ceil(pastTotal / PAGE_SIZE_PAST));
  record([{ kind: "page_view", path: "/event", ...ctx }]);

  // One builder, param overrides per link family — paging one list, turning
  // the calendar's month, or switching filters preserves everything else.
  // Changing type/q resets upcoming pagination (a filtered page 3 is nonsense).
  const qs = (over: Record<string, string | number | undefined>) => {
    const merged: Record<string, string | number | undefined> = {
      month: monthParam,
      type,
      q: q || undefined,
      upcoming_page: upcomingPage > 1 ? upcomingPage : undefined,
      past_page: pastPage > 1 ? pastPage : undefined,
      ...over,
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") params.set(k, String(v));
    const s = params.toString();
    return s ? `/event?${s}` : "/event";
  };
  const qsUpcoming = (page: number) => qs({ upcoming_page: page > 1 ? page : undefined });
  const qsPast = (page: number) => qs({ past_page: page > 1 ? page : undefined });
  const hrefForMonth = (key: string | null) => qs({ month: key ?? undefined });

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Events</h1>

      {/* List leads, map rides in a sidebar (fix list item 37, swapping the
          calendar and map from their original arrangement, fix list item 23).
          Mobile stacks main-first so the filterable list stays on top. */}
      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          {/* GET submit replaces the whole query string, hence the hidden carriers */}
          <form action="/event" role="search" className="flex gap-2">
            {type && <input type="hidden" name="type" value={type} />}
            {monthParam && <input type="hidden" name="month" value={monthParam} />}
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search events by name or location…"
              aria-label="Search events"
              className="w-full rounded border bg-white px-4 py-2 text-sm"
            />
            <button className="shrink-0 rounded bg-ink px-4 py-2 text-sm text-white">Search</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <Link href={qs({ type: undefined, upcoming_page: undefined })} className={`rounded-full border px-3 py-1 ${!type ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All</Link>
            {EVENT_TYPES.map((t) => (
              <Link key={t} href={qs({ type: t, upcoming_page: undefined })} className={`rounded-full border px-3 py-1 ${type === t ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
                {EVENT_TYPE_LABELS[t]}
              </Link>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            {events.slice(0, 3).map((e) => <EventCard key={e.slug} event={e} />)}
          </div>
          {events.length === 0 && (
            <p className="mt-4 text-graphite">
              {type || q ? <>No upcoming events match. <Link href={qs({ type: undefined, q: undefined, upcoming_page: undefined })} className="underline">Clear filters</Link></> : "No upcoming events."}
            </p>
          )}
          {/* Unconditional: the slot is booked inventory, so it must not vanish just
              because the listing is short. Only the split below is count-dependent. */}
          <div className="my-6"><AdSlot slotKey="events_mid" adverts={slots.get("events_mid") ?? []} showPlaceholders={showPlaceholders} path="/event" /></div>
          {events.length > 3 && (
            <div className="space-y-4">
              {events.slice(3).map((e) => <EventCard key={e.slug} event={e} />)}
            </div>
          )}
          <Pagination page={upcomingPage} pages={upcomingPages} hrefFor={qsUpcoming} />

          <h2 className="mt-6 text-lg font-bold text-ink">Calendar</h2>
          <div className="mt-3">
            <EventsCalendar month={month} events={monthEvents} hrefForMonth={hrefForMonth} />
          </div>
        </div>

        <aside className="shrink-0 lg:w-96">
          {/* Renders nothing until at least one upcoming event has geocoded
              coords. Shows all upcoming events regardless of list filters. */}
          <EventMap events={pins} />
        </aside>
      </div>

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
                <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-graphite">{fmt(e.starts_on)}</span>
                <Link href={`/event/${e.slug}`} className="font-medium hover:text-graphite">{e.title}</Link>
                {e.location && <span className="text-sm text-graphite break-words">{e.location}</span>}
              </li>
            ))}
          </ul>
          <Pagination page={pastPage} pages={pastPages} hrefFor={qsPast} />
        </section>
      )}
      <div className="my-10" />
    </div>
  );
}
