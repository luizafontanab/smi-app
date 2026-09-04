import Image from "next/image";
import Link from "next/link";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { requireConsole } from "@/lib/auth";
import { monthGrid, parseMonth } from "@/lib/calendar";
import { decideVideo, pinVideo } from "../actions";
import { CalendarView, type CalendarVideo } from "./CalendarView";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
] as const;

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
  const { data: videos } = view === "calendar"
    ? await db
        .from("videos")
        .select(SELECT)
        .or(
          `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
          `and(status.eq.published,published_at.gte.${start.toISOString()},published_at.lt.${end.toISOString()})`,
        )
    : await db
        .from("videos")
        .select(SELECT)
        .order("updated_at", { ascending: false })
        .limit(120);

  const byStatus = (s: string) => (videos ?? []).filter((x) => x.status === s);

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
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.key).slice(0, col.key === "published" ? 10 : 30);
            return (
              <div key={col.key} className="rounded-xl bg-white p-3 shadow-sm">
                <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-graphite">
                  {col.label} <span className="text-graphite">({byStatus(col.key).length})</span>
                </h2>
                <div className="mt-2 space-y-2">
                  {items.map((v) => (
                    <div key={v.id} className="flex gap-2 rounded border p-2.5 text-sm">
                      {v.thumbnail_path && (
                        <Image src={mediaUrl(v.thumbnail_path)!} alt="" width={56} height={32} className="h-8 w-14 shrink-0 rounded object-cover" unoptimized />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/console/videos/${v.id}`} className="font-medium leading-snug hover:text-graphite">{v.title}</Link>
                        <p className="mt-1 text-xs text-graphite">
                          {v.member?.name && <>{v.member.name} · </>}{v.source}
                          {v.scheduled_at && v.status === "scheduled" && <> · {new Date(v.scheduled_at).toLocaleString("en-GB")}</>}
                          {v.pinned_until && new Date(v.pinned_until) > new Date() && <> · 📌 pinned</>}
                        </p>
                        {v.status === "awaiting_approval" && (
                          <div className="mt-2 flex gap-2">
                            <form action={decideVideo}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="decision" value="approve" />
                              <button className="rounded bg-success px-2.5 py-1 text-xs text-white">Approve</button>
                            </form>
                            <Link href={`/console/videos/${v.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
                          </div>
                        )}
                        {v.status === "published" && (
                          <form action={pinVideo} className="mt-1.5 flex items-center gap-1 text-xs">
                            <input type="hidden" name="id" value={v.id} />
                            {v.pinned_until && new Date(v.pinned_until) > new Date() ? (
                              <>
                                <input type="hidden" name="days" value="0" />
                                <button className="text-graphite hover:text-ink">Unpin</button>
                              </>
                            ) : (
                              <>
                                <span className="text-graphite">📌 Pin</span>
                                <input type="number" name="days" defaultValue={2} min={1} max={30} className="w-10 rounded border px-1 py-0.5" />
                                <span className="text-graphite">days</span>
                                <button className="text-graphite hover:text-ink underline">Go</button>
                              </>
                            )}
                          </form>
                        )}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-graphite">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
