import Link from "next/link";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { requireConsole } from "@/lib/auth";
import { monthGrid, parseMonth } from "@/lib/calendar";
import { CalendarView, type CalendarVideo } from "./CalendarView";
import { VideoBoard, type BoardVideo } from "./VideoBoard";

export const dynamic = "force-dynamic";

// Columns and their labels now live with the board's transition matrix in
// lib/video-board.ts, so the two cannot drift.

const TABS = [
  { view: "board", label: "Board" },
  { view: "calendar", label: "Calendar" },
] as const;

const SELECT = "id, title, status, source, scheduled_at, published_at, pinned_until, thumbnail_path, member:members(name)";

export default async function VideosPage(props: PageProps<"/console/videos">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "calendar" ? "calendar" : "board";
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  // Same reasoning as Story Engine: the board's "most recently touched 120" is
  // the wrong window for a calendar — query by date range instead.
  const { start, end } = monthGrid(month);
  const videos = await must(
    view === "calendar"
      ? db
          .from("videos")
          .select(SELECT)
          .or(
            `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
            `and(status.eq.published,published_at.gte.${start.toISOString()},published_at.lt.${end.toISOString()})`,
          )
      : db
          .from("videos")
          .select(SELECT)
          .order("updated_at", { ascending: false })
          .limit(120),
    "console/videos list",
  );

  // The board is a client component, so thumbnail URLs are resolved here —
  // mediaUrl() reads server-only env.
  const boardVideos: BoardVideo[] = (videos ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    source: v.source,
    scheduled_at: v.scheduled_at,
    pinned_until: v.pinned_until,
    thumbnailUrl: mediaUrl(v.thumbnail_path),
    member: v.member,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Video Engine</h1>
        <Link href="/console/videos/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New video</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">Nothing publishes without approval.</p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/videos" : "/console/videos?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView month={month} videos={(videos ?? []) as CalendarVideo[]} />
      ) : (
        <VideoBoard videos={boardVideos} />
      )}
    </div>
  );
}
