import Link from "next/link";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { requireConsole } from "@/lib/auth";
import { dayKey, monthGrid, parseMonth } from "@/lib/calendar";
import { CalendarView, type CalendarEvent } from "./CalendarView";
import { EventBoard, type BoardEvent } from "./EventBoard";

export const dynamic = "force-dynamic";

// Columns and their labels now live with the board's transition matrix in
// lib/event-board.ts, so the two cannot drift.

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
  const events = await must(
    view === "calendar"
      ? db
          .from("events")
          .select(SELECT)
          .in("status", ["draft", "awaiting_approval", "published"])
          .gte("starts_on", dayKey(start))
          .lt("starts_on", dayKey(end))
      : db
          .from("events")
          .select(SELECT)
          .order("updated_at", { ascending: false })
          .limit(120),
    "console/events list",
  );

  // The board is a client component, so cover URLs are resolved here —
  // mediaUrl() reads server-only env.
  const boardEvents: BoardEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    source: e.source,
    starts_on: e.starts_on,
    coverUrl: mediaUrl(e.cover_path),
    member: e.member,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Events</h1>
        <Link href="/console/events/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New event</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">Nothing publishes without approval.</p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/events" : "/console/events?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView month={month} events={(events ?? []) as CalendarEvent[]} />
      ) : (
        <EventBoard events={boardEvents} />
      )}
    </div>
  );
}
