import Link from "next/link";
import { dayKey, monthGrid, monthKey, shiftMonth, WEEKDAYS } from "@/lib/calendar";
import { bucketEventsByDay, type CalendarEvent } from "@/lib/event-calendar";
import { EVENT_TYPE_LABELS, type EventType } from "@/lib/event-types";

/**
 * Public month view of published events, colour-coded by event type — the
 * public sibling of the console's OverviewCalendar (same grid maths from
 * lib/calendar, same chip/legend pattern), and like it a deliberate,
 * contained exception to the site's near-monochrome brand rule: five types
 * need five distinguishable hues, so the two brand accents are joined by
 * three Tailwind default hues used at matching tint strengths.
 *
 * Multi-day events appear on their start day only — see lib/event-calendar.
 */

const TYPE_STYLE: Record<EventType, { dot: string; chip: string }> = {
  webinar: { dot: "bg-sky-500", chip: "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25" },
  live_event: { dot: "bg-brand", chip: "bg-brand/15 text-brand-text hover:bg-brand/25" },
  open_house: { dot: "bg-gold", chip: "bg-gold/25 text-ink hover:bg-gold/35" },
  exhibition: { dot: "bg-violet-500", chip: "bg-violet-500/15 text-violet-700 hover:bg-violet-500/25" },
  // emerald-800, not -700: over an out-of-month bg-shade/70 cell the tint
  // composites to a bg where -700 sits below 4.5:1 for 12px text (WCAG AA).
  golf_challenge: { dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25" },
};
const UNTYPED_STYLE = { dot: "bg-graphite/60", chip: "bg-graphite/10 text-graphite hover:bg-graphite/20" };

const MAX_PER_DAY = 3;

const navLink = "tap rounded border px-2.5 py-1 text-sm text-graphite hover:border-ink hover:text-ink";

const styleFor = (type: string | null | undefined) => (type && type in TYPE_STYLE ? TYPE_STYLE[type as EventType] : UNTYPED_STYLE);

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function EventsCalendar({ month, events, hrefForMonth }: {
  month: Date;
  events: CalendarEvent[];
  /** Builds the month-nav hrefs (null = current month), preserving the listing pagination params. */
  hrefForMonth: (key: string | null) => string;
}) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());
  const byDay = bucketEventsByDay(events);
  // The phone agenda: only this month's days that have something on, in order.
  const agenda = days
    .filter((day) => day.getMonth() === month.getMonth())
    .flatMap((day) => {
      const key = dayKey(day);
      const dayEvents = byDay.get(key) ?? [];
      return dayEvents.length ? [[key, day, dayEvents] as const] : [];
    });

  return (
    <div data-part="events-calendar">
      <div data-part="events-calendar-nav" className="flex flex-wrap items-center gap-2">
        <Link data-part="pagination-link" href={hrefForMonth(monthKey(shiftMonth(month, -1)))} className={navLink} aria-label="Previous month">‹</Link>
        <h3 data-part="events-calendar-month" className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h3>
        <Link data-part="pagination-link" href={hrefForMonth(monthKey(shiftMonth(month, 1)))} className={navLink} aria-label="Next month">›</Link>
        <Link data-part="button-secondary" href={hrefForMonth(null)} className={`${navLink} ml-1`}>Today</Link>
      </div>

      <p data-part="events-calendar-legend" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite">
        {(Object.entries(TYPE_STYLE) as [EventType, typeof UNTYPED_STYLE][]).map(([type, s]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {EVENT_TYPE_LABELS[type]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${UNTYPED_STYLE.dot}`} /> Other
        </span>
      </p>

      {/* Phones get the month as an agenda instead of the grid (#33): seven
          ~48px columns truncated every title to two letters, and a title
          attribute is no help without hover. */}
      <div data-part="panel" className="mt-3 rounded-xl bg-white shadow-sm sm:hidden">
        {agenda.length === 0 ? (
          <p data-part="empty-state" className="p-4 text-sm text-graphite">No events this month.</p>
        ) : (
          <ol className="divide-y divide-line">
            {agenda.map(([key, day, dayEvents]) => (
              <li key={key} className={`flex gap-3 px-4 py-3 ${key === today ? "bg-brand/10" : ""}`}>
                <div className="w-12 shrink-0 text-center leading-tight">
                  <p className="text-xs font-semibold uppercase text-graphite">{day.toLocaleDateString("en-GB", { weekday: "short" })}</p>
                  <p className="text-xl font-bold text-ink">{day.getDate()}</p>
                  <span className="sr-only">{longDate(day)}{key === today ? " (today)" : ""}</span>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {dayEvents.map((event) => (
                    <li key={event.slug}>
                      {/* min-h-11, not .tap: the unlayered .tap rule would
                          make this full-width row an inline-flex chip. */}
                      <Link data-part="events-calendar-chip" href={`/event/${event.slug}`} className={`flex min-h-11 items-baseline gap-2 rounded px-2.5 py-2.5 text-sm ${styleFor(event.type).chip}`}>
                        {event.starts_time && <span className="shrink-0 tabular-nums opacity-80">{event.starts_time.slice(0, 5)}</span>}
                        <span className="min-w-0 break-words font-medium">{event.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* No min-width: the calendar can render at any column width — chips
          truncate, colour + the title attr carry the rest. */}
      <div data-part="panel" className="mt-3 hidden rounded-xl bg-white p-3 shadow-sm sm:block">
        <div>
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-graphite">
                <span aria-hidden="true">{d}</span>
                {/* days[0..6] is the grid's first week, so index i lands on that weekday */}
                <span className="sr-only">{days[i].toLocaleDateString("en-GB", { weekday: "long" })}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-shade">
            {days.map((day) => {
              const key = dayKey(day);
              const dayEvents = byDay.get(key) ?? [];
              const outside = day.getMonth() !== month.getMonth();
              return (
                <div data-part="events-calendar-day"
                  key={key}
                  className={`min-h-20 p-1.5 ${outside ? "bg-shade/70" : "bg-white"} ${key === today ? "ring-2 ring-inset ring-brand" : ""}`}
                >
                  <div className={`px-0.5 text-xs ${key === today ? "font-bold text-ink" : "text-graphite"}`}>
                    <span aria-hidden="true">{day.getDate()}</span>
                    <span className="sr-only">{longDate(day)}</span>
                  </div>
                  {/* Outside-month muting comes from the cell's bg-shade/70 only —
                      an opacity wrapper here dims 12px chip text below WCAG AA. */}
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, MAX_PER_DAY).map((event) => {
                      const style = styleFor(event.type);
                      return (
                        <Link data-part="events-calendar-chip"
                          key={event.slug}
                          href={`/event/${event.slug}`}
                          title={event.title}
                          className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${style.chip}`}
                        >
                          {event.starts_time && <span className="tabular-nums opacity-70">{event.starts_time.slice(0, 5)} </span>}
                          {event.title}
                          <span className="sr-only">, {longDate(day)}</span>
                        </Link>
                      );
                    })}
                    {dayEvents.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-graphite">+{dayEvents.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
