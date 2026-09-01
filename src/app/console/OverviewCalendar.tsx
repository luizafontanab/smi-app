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
  story: { label: "Stories", dot: "bg-brand", chip: "bg-brand/15 text-brand hover:bg-brand/25" },
  video: { label: "Videos", dot: "bg-gold", chip: "bg-gold/25 text-ink hover:bg-gold/35" },
  newsletter: { label: "Newsletter", dot: "bg-sky-500", chip: "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25" },
  event: { label: "Events", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25" },
};

const MAX_PER_DAY = 4;

const navLink = "rounded border px-2.5 py-1 text-sm text-gray-500 hover:border-ink hover:text-ink";

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
        <p className="ml-auto flex flex-wrap items-center gap-3 text-xs text-gray-500">
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
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-100">
            {days.map((day) => {
              const key = dayKey(day);
              const dayItems = byDay.get(key) ?? [];
              const outside = day.getMonth() !== month.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-24 p-1.5 ${outside ? "bg-gray-50/70" : "bg-white"} ${key === today ? "ring-2 ring-inset ring-brand" : ""}`}
                >
                  <div className={`px-0.5 text-xs ${key === today ? "font-bold text-ink" : outside ? "text-gray-500" : "text-gray-600"}`}>
                    {day.getDate()}
                  </div>
                  <div className={`mt-1 space-y-1 ${outside ? "opacity-55" : ""}`}>
                    {dayItems.slice(0, MAX_PER_DAY).map((item) => (
                      <Link
                        key={`${item.type}-${item.id}`}
                        href={item.href}
                        title={item.title}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${TYPE_STYLE[item.type].chip}`}
                      >
                        {item.time && <span className="tabular-nums opacity-70">{item.time} </span>}
                        {item.title}
                      </Link>
                    ))}
                    {dayItems.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-gray-500">+{dayItems.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">Nothing scheduled or published this month.</p>
      )}
    </div>
  );
}
