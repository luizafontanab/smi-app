import Link from "next/link";
import { dayKey, monthGrid, monthKey, shiftMonth, WEEKDAYS } from "@/lib/calendar";

/**
 * Read-only month view of the video diary — same shape as Story Engine's
 * CalendarView. Scheduled videos sit on their scheduled_at, published ones on
 * their published_at.
 */

export type CalendarVideo = {
  id: string;
  title: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  member: { name: string } | null;
};

const MAX_PER_DAY = 3;

const navLink = "rounded border px-2.5 py-1 text-sm text-gray-500 hover:border-ink hover:text-ink";

export function CalendarView({ month, videos }: { month: Date; videos: CalendarVideo[] }) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());

  const byDay = new Map<string, { video: CalendarVideo; at: Date }[]>();
  for (const video of videos) {
    const raw = video.status === "published" ? video.published_at : video.scheduled_at;
    if (!raw) continue;
    const at = new Date(raw);
    const key = dayKey(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push({ video, at });
    else byDay.set(key, [{ video, at }]);
  }
  for (const bucket of byDay.values()) bucket.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <Link href={`/console/videos?view=calendar&month=${monthKey(shiftMonth(month, -1))}`} className={navLink} aria-label="Previous month">‹</Link>
        <h2 className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h2>
        <Link href={`/console/videos?view=calendar&month=${monthKey(shiftMonth(month, 1))}`} className={navLink} aria-label="Next month">›</Link>
        <Link href="/console/videos?view=calendar" className={`${navLink} ml-1`}>Today</Link>
        <p className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink" /> Published
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-graphite" /> Scheduled
          </span>
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
              const items = byDay.get(key) ?? [];
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
                    {items.slice(0, MAX_PER_DAY).map(({ video, at }) => (
                      <Link
                        key={video.id}
                        href={`/console/videos/${video.id}?from=calendar&month=${monthKey(month)}`}
                        title={`${video.title}${video.member?.name ? ` — ${video.member.name}` : ""}`}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${
                          video.status === "published"
                            ? "bg-ink/10 text-ink hover:bg-ink/20"
                            : "border border-dashed border-graphite/50 text-graphite hover:bg-graphite/10"
                        }`}
                      >
                        <span className="tabular-nums opacity-70">
                          {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>{" "}
                        {video.title}
                      </Link>
                    ))}
                    {items.length > MAX_PER_DAY && (
                      <p className="px-1.5 text-xs text-gray-500">+{items.length - MAX_PER_DAY} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {videos.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">
          Nothing scheduled or published this month. Set a date on a draft from its video page.
        </p>
      )}
    </div>
  );
}
