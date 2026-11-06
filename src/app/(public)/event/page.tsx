import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { dayKey, monthGrid, parseMonth } from "@/lib/calendar";
import { EVENT_TYPES, EVENT_TYPE_LABELS, isEventType } from "@/lib/event-types";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { eventsInRange, industries, pastEvents, upcomingEventPins, upcomingEvents } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { Pagination } from "@/components/Pagination";
import { ScrollToHash } from "@/components/ScrollToHash";
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
  // Industries hidden from the public (flag industries_public): no pills, and
  // an old ?industry= link is ignored rather than filtering invisibly.
  const showIndustries = await isFeatureEnabled("industries_public");
  const industry = showIndustries && typeof sp.industry === "string" ? sp.industry : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  // Only a well-formed month is worth carrying in links; parseMonth already
  // falls back to the current month for anything else.
  const monthParam = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : undefined;
  const month = parseMonth(monthParam);
  const grid = monthGrid(month);

  // Industry goes to all four reads, unlike type/q/paging which narrow only the
  // upcoming list: an industry narrows what the page is *about*, so a calendar
  // and a map still showing every trade would read as a bug.
  const [{ events, total: upcomingTotal }, { events: past, total: pastTotal }, monthEvents, pins, inds, banners, showPlaceholders, ctx] = await Promise.all([
    upcomingEvents({ limit: PAGE_SIZE_UPCOMING, offset: (upcomingPage - 1) * PAGE_SIZE_UPCOMING, type, q, industry }),
    pastEvents({ limit: PAGE_SIZE_PAST, offset: (pastPage - 1) * PAGE_SIZE_PAST, industry }),
    eventsInRange(dayKey(grid.start), dayKey(grid.end), { industry }),
    upcomingEventPins({ industry }),
    showIndustries ? industries() : [],
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
      industry,
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
  // #calendar so paging a month lands back on the grid rather than at the top
  // of the page (fix list): the month links are ordinary navigations, and the
  // calendar sits below the listing and the ad slot. ScrollToHash covers Safari,
  // which keeps the fragment but does not scroll to it on a full load.
  const hrefForMonth = (key: string | null) => `${qs({ month: key ?? undefined })}#calendar`;

  return (
    <div data-part="event-list-page" className="mx-auto max-w-6xl px-4">
      <ScrollToHash />
      <h1 data-part="page-title" className="mt-6 text-2xl font-bold text-ink">Events</h1>

      {/* List leads, map rides in a sidebar (fix list item 37, swapping the
          calendar and map from their original arrangement, fix list item 23).
          Mobile stacks main-first so the filterable list stays on top. */}
      <div data-part="event-list-layout" className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div data-part="event-list-main" className="min-w-0 flex-1">
          {/* GET submit replaces the whole query string, hence the hidden carriers */}
          <form data-part="search-form" action="/event" role="search" className="flex gap-2">
            {type && <input type="hidden" name="type" value={type} />}
            {industry && <input type="hidden" name="industry" value={industry} />}
            {monthParam && <input type="hidden" name="month" value={monthParam} />}
            <input data-part="form-input"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search events by name or location…"
              aria-label="Search events"
              enterKeyHint="search"
              // 16px on phones so iOS doesn't zoom the page on focus (#33)
              className="tap w-full min-w-0 rounded border border-line bg-white px-4 py-2 text-base sm:text-sm"
            />
            <button data-part="button-primary" className="tap shrink-0 rounded bg-ink px-4 py-2 text-sm text-white">Search</button>
          </form>
          {/* `tap`: 44px tall on touch screens only, so desktop looks the same (#33) */}
          <div data-part="filter-pills" className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <Link data-part="filter-pill" href={qs({ type: undefined, upcoming_page: undefined })} className={`tap rounded-full border px-3 py-1 ${!type ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All</Link>
            {EVENT_TYPES.map((t) => (
              <Link data-part="filter-pill" key={t} href={qs({ type: t, upcoming_page: undefined })} className={`tap rounded-full border px-3 py-1 ${type === t ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
                {EVENT_TYPE_LABELS[t]}
              </Link>
            ))}
          </div>
          {/* A second axis, kept on its own row: this one also re-filters the
              calendar and the map, where the type pills only touch the list.
              Both page families reset — a filtered page 3 is nonsense. */}
          {showIndustries && (
            <nav data-part="filter-pills" aria-label="Filter by industry" className="mt-2 flex min-w-0 gap-1.5 overflow-x-auto pb-1 text-xs">
              <Link data-part="filter-pill" href={qs({ industry: undefined, upcoming_page: undefined, past_page: undefined })} className={`tap shrink-0 rounded-full border px-3 py-1 ${!industry ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All industries</Link>
              {inds.map((i) => (
                <Link data-part="filter-pill" key={i.slug} href={qs({ industry: i.slug, upcoming_page: undefined, past_page: undefined })} className={`tap shrink-0 whitespace-nowrap rounded-full border px-3 py-1 ${industry === i.slug ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
                  {i.name}
                </Link>
              ))}
            </nav>
          )}

          <div data-part="card-grid" className="mt-5 space-y-4">
            {events.slice(0, 3).map((e) => <EventCard key={e.slug} event={e} />)}
          </div>
          {events.length === 0 && (
            <p data-part="empty-state" className="mt-4 text-graphite">
              {type || q || industry ? <>No upcoming events match. <Link href={qs({ type: undefined, q: undefined, industry: undefined, upcoming_page: undefined, past_page: undefined })} className="underline">Clear filters</Link></> : "No upcoming events."}
            </p>
          )}
          {/* Unconditional: the slot is booked inventory, so it must not vanish just
              because the listing is short. Only the split below is count-dependent. */}
          <div data-part="ad-slot-wrap" className="my-6"><AdSlot slotKey="events_mid" adverts={slots.get("events_mid") ?? []} showPlaceholders={showPlaceholders} path="/event" /></div>
          {events.length > 3 && (
            <div data-part="card-grid" className="space-y-4">
              {events.slice(3).map((e) => <EventCard key={e.slug} event={e} />)}
            </div>
          )}
          <Pagination page={upcomingPage} pages={upcomingPages} hrefFor={qsUpcoming} />
        </div>

        <aside data-part="event-map-aside" className="shrink-0 lg:w-96">
          {/* Renders nothing until at least one upcoming event has geocoded
              coords. Ignores the list's type/search filters and its paging, but
              does honour the industry — see the fetch note above. */}
          <EventMap events={pins} />
        </aside>
      </div>

      {/* Outside the list/map flex row on purpose: a 7-column month grid beside
          the 384px map only had ~700px to work with at lg, which cramped the day
          cells and truncated most chips. Full container width instead — the
          component is fluid by design (see its own note on having no min-width). */}
      <section data-part="events-calendar-section" id="calendar" className="mt-8 scroll-mt-4">
        <h2 data-part="section-title" className="text-lg font-bold text-ink">Calendar</h2>
        <div className="mt-3">
          <EventsCalendar month={month} events={monthEvents} hrefForMonth={hrefForMonth} />
        </div>
      </section>

      {/* Past events keep their pages — the old site's /event/ URLs were indexed
          for years, and listing only what is upcoming quietly retired each one
          the morning after its date. A compact list, not cards: this is an
          archive people arrive at from a search result, not a browse surface. */}
      {past.length > 0 && (
        <section data-part="event-past" className="mt-12">
          <h2 data-part="section-title" className="text-lg font-bold text-ink">Past events</h2>
          {/* Two fixed columns from sm, stacked below it: a wrapping flex row put
              short titles beside the date and long ones under it (#33). */}
          <ul data-part="panel" className="mt-3 divide-y divide-line rounded-lg bg-white shadow-sm">
            {past.map((e) => (
              <li key={e.slug} className="grid gap-0.5 px-5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-3">
                <span data-part="card-meta" className="text-xs uppercase tracking-wide text-graphite">{fmt(e.starts_on)}</span>
                <div className="min-w-0">
                  <Link data-part="card-title" href={`/event/${e.slug}`} className="font-medium break-words hover:text-graphite">{e.title}</Link>
                  {e.location && <p data-part="card-meta" className="text-sm text-graphite break-words">{e.location}</p>}
                </div>
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
