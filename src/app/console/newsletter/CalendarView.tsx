import Link from "next/link";
import { dayKey, monthGrid, monthKey, shiftMonth, WEEKDAYS } from "@/lib/calendar";

/**
 * Read-only month view of newsletter issues, mirroring the Story Engine's
 * CalendarView (src/app/console/stories/CalendarView.tsx). Scheduled issues
 * sit on their scheduled_at, sent ones on their sent_at. No per-issue detail
 * page exists, so chips link back to the board instead of an [id] route.
 */

export type CalendarIssue = {
  id: string;
  number: number;
  subject: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
};

const MAX_PER_DAY = 3;

const navLink = "rounded border px-2.5 py-1 text-sm text-graphite hover:border-ink hover:text-ink";

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function CalendarView({ month, issues }: { month: Date; issues: CalendarIssue[] }) {
  const { days } = monthGrid(month);
  const today = dayKey(new Date());

  const byDay = new Map<string, { issue: CalendarIssue; at: Date }[]>();
  for (const issue of issues) {
    const raw = issue.status === "sent" ? issue.sent_at : issue.scheduled_at;
    if (!raw) continue;
    const at = new Date(raw);
    const key = dayKey(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push({ issue, at });
    else byDay.set(key, [{ issue, at }]);
  }
  for (const bucket of byDay.values()) bucket.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <Link href={`/console/newsletter?view=calendar&month=${monthKey(shiftMonth(month, -1))}`} className={navLink} aria-label="Previous month">‹</Link>
        <h2 className="min-w-40 text-center text-lg font-bold text-ink">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </h2>
        <Link href={`/console/newsletter?view=calendar&month=${monthKey(shiftMonth(month, 1))}`} className={navLink} aria-label="Next month">›</Link>
        <Link href="/console/newsletter?view=calendar" className={`${navLink} ml-1`}>Today</Link>
        <p className="ml-auto flex items-center gap-3 text-xs text-graphite">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink" /> Sent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-graphite" /> Scheduled
          </span>
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
                    {items.slice(0, MAX_PER_DAY).map(({ issue, at }) => (
                      <Link
                        key={issue.id}
                        href="/console/newsletter?view=board"
                        title={`#${issue.number} — ${issue.subject}`}
                        className={`block truncate rounded px-1.5 py-1 text-xs leading-tight ${
                          issue.status === "sent"
                            ? "bg-ink/10 text-ink hover:bg-ink/20"
                            : "border border-dashed border-graphite/50 text-graphite hover:bg-graphite/10"
                        }`}
                      >
                        <span className="tabular-nums opacity-70">
                          {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>{" "}
                        {issue.subject}
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

      {issues.length === 0 && (
        <p className="mt-3 text-sm text-graphite">
          Nothing scheduled or sent this month. Schedule a draft from the board.
        </p>
      )}
    </div>
  );
}
