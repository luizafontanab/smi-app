import Link from "next/link";
import { serviceDb } from "@/lib/db/server";
import { requireConsole } from "@/lib/auth";
import { decideStory, pinStory } from "../actions";
import { CalendarView, monthGrid, parseMonth, type CalendarStory } from "./CalendarView";

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

const SELECT = "id, title, status, source, scheduled_at, published_at, pinned_until, member:members(name)";

export default async function StoriesPage(props: PageProps<"/console/stories">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "calendar" ? "calendar" : "board";
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  // The board's "most recently touched 120" is the wrong window for a calendar —
  // a story scheduled months out can fall outside it. Query by date range instead.
  const { start, end } = monthGrid(month);
  const { data: stories } = view === "calendar"
    ? await db
        .from("stories")
        .select(SELECT)
        .or(
          `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
          `and(status.eq.published,published_at.gte.${start.toISOString()},published_at.lt.${end.toISOString()})`,
        )
    : await db
        .from("stories")
        .select(SELECT)
        .order("updated_at", { ascending: false })
        .limit(120);

  const byStatus = (s: string) => (stories ?? []).filter((x) => x.status === s);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Story Engine</h1>
        <Link href="/console/stories/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New story</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Nothing publishes without approval. The &quot;suggested&quot; column arrives with the Content OS (module 6).
      </p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/stories" : "/console/stories?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView month={month} stories={(stories ?? []) as CalendarStory[]} />
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.key).slice(0, col.key === "published" ? 10 : 30);
            return (
              <div key={col.key} className="rounded-xl bg-white p-3 shadow-sm">
                <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-gray-500">
                  {col.label} <span className="text-gray-300">({byStatus(col.key).length})</span>
                </h2>
                <div className="mt-2 space-y-2">
                  {items.map((s) => (
                    <div key={s.id} className="rounded border p-2.5 text-sm">
                      <Link href={`/console/stories/${s.id}`} className="font-medium leading-snug hover:text-graphite">{s.title}</Link>
                      <p className="mt-1 text-xs text-gray-400">
                        {s.member?.name && <>{s.member.name} · </>}{s.source}
                        {s.scheduled_at && s.status === "scheduled" && <> · {new Date(s.scheduled_at).toLocaleString("en-GB")}</>}
                        {s.pinned_until && new Date(s.pinned_until) > new Date() && <> · 📌 pinned</>}
                      </p>
                      {s.status === "awaiting_approval" && (
                        <div className="mt-2 flex gap-2">
                          <form action={decideStory}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="decision" value="approve" />
                            <button className="rounded bg-green-600 px-2.5 py-1 text-xs text-white">Approve</button>
                          </form>
                          <Link href={`/console/stories/${s.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
                        </div>
                      )}
                      {s.status === "published" && (
                        <form action={pinStory} className="mt-1.5 flex items-center gap-1 text-xs">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="days" value={s.pinned_until && new Date(s.pinned_until) > new Date() ? "0" : "2"} />
                          <button className="text-gray-400 hover:text-ink">
                            {s.pinned_until && new Date(s.pinned_until) > new Date() ? "Unpin" : "📌 Pin 2 days"}
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-gray-300">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
