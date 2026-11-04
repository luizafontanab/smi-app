import Link from "next/link";
import { dayKey, monthGrid, monthKey, shiftMonth, WEEKDAYS } from "@/lib/calendar";

/**
 * Read-only month view of events — same shape as Video Engine's CalendarView,
 * but bucketed by starts_on (a real event date) rather than a publish
 * schedule, and not restricted to published so admins can see what's coming.
 */

export type CalendarEvent = {
  id: string;
  title: string;
  status: string;
  location: string | null;
  starts_on: string;
  starts_time: string | null;
  ends_on: string | null;
  member: { name: string } | null;
};

const MAX_PER_DAY = 3;

const navLink = "rounded border px-2.5 py-1 text-sm text-graphite hover:border-ink hover:text-ink";

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const fmtTime = (t: string) => {
  const [h, m] = t.split(":");
  const d = new Date(2000, 0, 1, Number(h), Number(m));
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

export function CalendarView({ month, events }: { month: Date; events: CalendarEvent[] }) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());

  // starts_on is a date column (YYYY-MM-DD) — parse as UTC noon so local
  // timezones west of Greenwich don't shift it back a day.
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const at = new Date(`${event.starts_on}T12:00:00Z`);
    const key = dayKey(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(event);
    else byDay.set(key, [event]);
  }
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => (a.starts_time ?? "").localeCompare(b.starts_time ?? ""));
  }

  return (
    <div className="mt-5">
      {/* flex-wrap: on a phone the key drops under the month nav instead of
          running off the right edge (#33). */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/console/events?view=calendar&month=${monthKey(shiftMonth(month, -1))}`} className={navLink} aria-label="Previous month">‹</Link>
        <h2 className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h2>
        <Link href={`/console/events?view=calendar&month=${monthKey(shiftMonth(month, 1))}`} className={navLink} aria-label="Next month">›</Link>
        <Link href="/console/events?view=calendar" className={`${navLink} ml-1`}>Today</Link>
        <p className="ml-auto flex items-center gap-3 text-xs text-graphite">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink" /> Published
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-graphite" /> Draft / pending
          </span>
        </p>
      </div>

      {/* relative: the day labels' sr-only spans are absolutely positioned, and
          without a positioned box here they escape this scroller's clipping and
          widen the whole page on a phone (#33). */}
      <div className="relative mt-3 overflow-x-auto rounded-xl bg-white p-3 shadow-sm">
        <div className="min-w-[720px]">
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
              const items = byDay.get(key) ?? [];
              const outside = day.getMonth() !== month.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-24 p-1.5 ${outside ? "bg-shade/70" : "bg-white"} ${key === today ? "ring-2 ring-inset ring-brand" : ""}`}
                >
                  <div className={`px-0.5 text-xs ${key === today ? "font-bold text-ink" : outside ? "text-graphite" : "text-graphite"}`}>
                    <span aria-hidden="true">{day.getDate()}</span>
                    <span className="sr-only">{longDate(day)}</span>
                  </div>
                  <div className={`mt-1 space-y-1 ${outside ? "opacity-55" : ""}`}>
                    {items.slice(0, MAX_PER_DAY).map((event) => (
                      <Link
                        key={event.id}
                        href={`/console/events/${event.id}?from=calendar&month=${monthKey(month)}`}
                        title={`${event.title}${event.ends_on && event.ends_on > event.starts_on ? ` — ends ${event.ends_on}` : ""}${event.member?.name ? ` — ${event.member.name}` : ""}`}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${
                          event.status === "published"
                            ? "bg-ink/10 text-ink hover:bg-ink/20"
                            : "border border-dashed border-graphite/50 text-graphite hover:bg-graphite/10"
                        }`}
                      >
                        {event.starts_time && (
                          <span className="tabular-nums opacity-70">{fmtTime(event.starts_time)} </span>
                        )}
                        {event.title}
                        <span className="sr-only">, {longDate(day)}</span>
                      </Link>
                    ))}
                    {items.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-graphite">+{items.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {events.length === 0 && (
        <p className="mt-3 text-sm text-graphite">
          Nothing on the calendar this month.
        </p>
      )}
    </div>
  );
}
