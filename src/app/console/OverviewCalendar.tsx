import Link from "next/link";
import { dayKey, monthGrid, monthKey, shiftMonth, WEEKDAYS } from "@/lib/calendar";

/**
 * Command Centre's month view — stories, videos, newsletter issues and events
 * merged onto one grid, colour-coded by type (unlike each module's own
 * calendar, which colour-codes by status). A deliberate, contained exception
 * to the site's near-monochrome brand rule (globals.css), scoped to this
 * widget only.
 */

export type OverviewType = "story" | "video" | "newsletter" | "event";

export type OverviewItem = {
  id: string;
  type: OverviewType;
  title: string;
  date: Date;
  time?: string | null;
  href: string;
};

const TYPE_STYLE: Record<OverviewType, { label: string; dot: string; chip: string }> = {
  story: { label: "Stories", dot: "bg-brand", chip: "bg-brand/15 text-brand-text hover:bg-brand/25" },
  video: { label: "Videos", dot: "bg-gold", chip: "bg-gold/25 text-ink hover:bg-gold/35" },
  newsletter: { label: "Newsletter", dot: "bg-sky-500", chip: "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25" },
  // emerald-800, not -700: the chip tint over an out-of-month bg-shade/70
  // cell composites to a bg where -700 sits at 4.29:1 (axe fail for 12px).
  event: { label: "Events", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25" },
};

const MAX_PER_DAY = 4;

const navLink = "rounded border px-2.5 py-1 text-sm text-graphite hover:border-ink hover:text-ink";

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function OverviewCalendar({ month, items }: { month: Date; items: OverviewItem[] }) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());

  const byDay = new Map<string, OverviewItem[]>();
  for (const item of items) {
    const key = dayKey(item.date);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/console?month=${monthKey(shiftMonth(month, -1))}`} className={navLink} aria-label="Previous month">‹</Link>
        <h2 className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h2>
        <Link href={`/console?month=${monthKey(shiftMonth(month, 1))}`} className={navLink} aria-label="Next month">›</Link>
        <Link href="/console" className={`${navLink} ml-1`}>Today</Link>
        <p className="ml-auto flex flex-wrap items-center gap-3 text-xs text-graphite">
          {(Object.entries(TYPE_STYLE) as [OverviewType, typeof TYPE_STYLE[OverviewType]][]).map(([type, s]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl bg-white p-3 shadow-sm">
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
              const dayItems = byDay.get(key) ?? [];
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
                  {/* Outside-month muting comes from the cell's bg-shade/70 only —
                      an opacity wrapper here dims 12px chip text below WCAG AA. */}
                  <div className="mt-1 space-y-1">
                    {dayItems.slice(0, MAX_PER_DAY).map((item) => (
                      <Link
                        key={`${item.type}-${item.id}`}
                        href={item.href}
                        title={item.title}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${TYPE_STYLE[item.type].chip}`}
                      >
                        {item.time && <span className="tabular-nums">{item.time} </span>}
                        {item.title}
                        <span className="sr-only">, {longDate(day)}</span>
                      </Link>
                    ))}
                    {dayItems.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-graphite">+{dayItems.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <p className="mt-3 text-sm text-graphite">Nothing scheduled or published this month.</p>
      )}
    </div>
  );
}
