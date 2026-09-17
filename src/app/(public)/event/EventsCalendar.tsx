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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={hrefForMonth(monthKey(shiftMonth(month, -1)))} className={navLink} aria-label="Previous month">‹</Link>
        <h3 className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h3>
        <Link href={hrefForMonth(monthKey(shiftMonth(month, 1)))} className={navLink} aria-label="Next month">›</Link>
        <Link href={hrefForMonth(null)} className={`${navLink} ml-1`}>Today</Link>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite">
        {(Object.entries(TYPE_STYLE) as [EventType, typeof UNTYPED_STYLE][]).map(([type, s]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {EVENT_TYPE_LABELS[type]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${UNTYPED_STYLE.dot}`} /> Other
        </span>
      </p>

      {/* No min-width: the calendar can render at any column width — chips
          truncate, colour + the title attr carry the rest. */}
      <div className="mt-3 rounded-xl bg-white p-3 shadow-sm">
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
                <div
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
                      const style = event.type && event.type in TYPE_STYLE ? TYPE_STYLE[event.type as EventType] : UNTYPED_STYLE;
                      return (
                        <Link
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
