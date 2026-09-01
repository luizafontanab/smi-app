import Image from "next/image";
import Link from "next/link";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { requireConsole } from "@/lib/auth";
import { monthGrid, parseMonth } from "@/lib/calendar";
import { decideEvent } from "../actions";
import { CalendarView, type CalendarEvent } from "./CalendarView";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" },
] as const;

const TABS = [
  { view: "board", label: "Board" },
  { view: "calendar", label: "Calendar" },
] as const;

const SELECT = "id, title, status, source, location, starts_on, starts_time, ends_on, updated_at, cover_path, member:members(name)";

export default async function EventsPage(props: PageProps<"/console/events">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "calendar" ? "calendar" : "board";
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  // An event's date exists before it's approved, so — unlike Story/Video's
  // calendar — don't restrict to published; show drafts/pending on their date too.
  const { start, end } = monthGrid(month);
  const { data: events } = view === "calendar"
    ? await db
        .from("events")
        .select(SELECT)
        .in("status", ["draft", "awaiting_approval", "published"])
        .gte("starts_on", start.toISOString().slice(0, 10))
        .lt("starts_on", end.toISOString().slice(0, 10))
    : await db
        .from("events")
        .select(SELECT)
        .order("updated_at", { ascending: false })
        .limit(120);

  const byStatus = (s: string) => (events ?? []).filter((x) => x.status === s);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Events</h1>
        <Link href="/console/events/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New event</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">Nothing publishes without approval.</p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/events" : "/console/events?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView month={month} events={(events ?? []) as CalendarEvent[]} />
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = byStatus(col.key).slice(0, col.key === "published" ? 10 : 30);
            return (
              <div key={col.key} className="rounded-xl bg-white p-3 shadow-sm">
                <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-gray-500">
                  {col.label} <span className="text-gray-500">({byStatus(col.key).length})</span>
                </h2>
                <div className="mt-2 space-y-2">
                  {items.map((e) => (
                    <div key={e.id} className="flex gap-2 rounded border p-2.5 text-sm">
                      {e.cover_path && (
                        <Image src={mediaUrl(e.cover_path)!} alt="" width={56} height={32} className="h-8 w-14 shrink-0 rounded object-cover" unoptimized />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/console/events/${e.id}`} className="font-medium leading-snug hover:text-graphite">{e.title}</Link>
                        <p className="mt-1 text-xs text-gray-500">
                          {e.member?.name && <>{e.member.name} · </>}{e.source} · {new Date(e.starts_on).toLocaleDateString("en-GB", { timeZone: "UTC" })}
                        </p>
                        {e.status === "awaiting_approval" && (
                          <div className="mt-2 flex gap-2">
                            <form action={decideEvent}>
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="decision" value="approve" />
                              <button className="rounded bg-green-600 px-2.5 py-1 text-xs text-white">Approve</button>
                            </form>
                            <Link href={`/console/events/${e.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-gray-500">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
