import Link from "next/link";

/**
 * Read-only month view of the story diary (USE-CASES A: "reviews the calendar
 * view"). Scheduled stories sit on their scheduled_at, published ones on their
 * published_at. Navigation is plain links — the whole view stays server-rendered
 * and a month is shareable by URL.
 */

export type CalendarStory = {
  id: string;
  title: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  member: { name: string } | null;
};

/** Local YYYY-MM-DD — the bucket key. Not toISOString, which would shift a
 *  late-evening story into the next day whenever the server is behind UTC. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** `YYYY-MM` → first of that month, falling back to the current month. */
export function parseMonth(value: string | undefined): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  return new Date(Number(m[1]), month - 1, 1);
}

/**
 * The cells the grid draws, Mon-first: whole weeks from the one containing the
 * 1st to the one containing the last day — 5 rows most months, 6 when the month
 * straddles them. `start`/`end` bound the DB query, so the leading and trailing
 * cells borrowed from the neighbouring months get filled too.
 */
export function monthGrid(month: Date) {
  const lead = (month.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - lead);
  const days = Array.from({ length: cells }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + cells), days };
}

const shiftMonth = (month: Date, by: number) => new Date(month.getFullYear(), month.getMonth() + by, 1);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

const navLink = "rounded border px-2.5 py-1 text-sm text-gray-500 hover:border-navy hover:text-navy";

export function CalendarView({ month, stories }: { month: Date; stories: CalendarStory[] }) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());

  const byDay = new Map<string, { story: CalendarStory; at: Date }[]>();
  for (const story of stories) {
    const raw = story.status === "published" ? story.published_at : story.scheduled_at;
    if (!raw) continue;
    const at = new Date(raw);
    const key = dayKey(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push({ story, at });
    else byDay.set(key, [{ story, at }]);
  }
  for (const bucket of byDay.values()) bucket.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <Link href={`/console/stories?view=calendar&month=${monthKey(shiftMonth(month, -1))}`} className={navLink} aria-label="Previous month">‹</Link>
        <h2 className="min-w-40 text-center text-lg font-bold text-navy">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h2>
        <Link href={`/console/stories?view=calendar&month=${monthKey(shiftMonth(month, 1))}`} className={navLink} aria-label="Next month">›</Link>
        <Link href="/console/stories?view=calendar" className={`${navLink} ml-1`}>Today</Link>
        <p className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-navy" /> Published
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-steel" /> Scheduled
          </span>
        </p>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl bg-white p-3 shadow-sm">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-gray-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-100">
            {days.map((day) => {
              const key = dayKey(day);
              const items = byDay.get(key) ?? [];
              const outside = day.getMonth() !== month.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-24 p-1.5 ${outside ? "bg-gray-50/70" : "bg-white"} ${key === today ? "ring-2 ring-inset ring-amber" : ""}`}
                >
                  <div className={`px-0.5 text-xs ${key === today ? "font-bold text-navy" : outside ? "text-gray-300" : "text-gray-400"}`}>
                    {day.getDate()}
                  </div>
                  <div className={`mt-1 space-y-1 ${outside ? "opacity-55" : ""}`}>
                    {items.slice(0, MAX_PER_DAY).map(({ story, at }) => (
                      <Link
                        key={story.id}
                        href={`/console/stories/${story.id}?from=calendar&month=${monthKey(month)}`}
                        title={`${story.title}${story.member?.name ? ` — ${story.member.name}` : ""}`}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${
                          story.status === "published"
                            ? "bg-navy/10 text-navy hover:bg-navy/20"
                            : "border border-dashed border-steel/50 text-steel hover:bg-steel/10"
                        }`}
                      >
                        <span className="tabular-nums opacity-70">
                          {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>{" "}
                        {story.title}
                      </Link>
                    ))}
                    {items.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-gray-400">+{items.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {stories.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          Nothing scheduled or published this month. Set a date on a draft from its story page.
        </p>
      )}
    </div>
  );
}
