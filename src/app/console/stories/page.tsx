import Link from "next/link";
import { serviceDb } from "@/lib/db/server";
import { requireConsole } from "@/lib/auth";
import { decideStory, pinStory } from "../actions";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
] as const;

export default async function StoriesPage() {
  await requireConsole();
  const db = serviceDb();
  const { data: stories } = await db
    .from("stories")
    .select("id, title, status, source, scheduled_at, published_at, pinned_until, member:members(name)")
    .order("updated_at", { ascending: false })
    .limit(120);

  const byStatus = (s: string) => (stories ?? []).filter((x) => x.status === s);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Story Engine</h1>
        <Link href="/console/stories/new" className="rounded bg-navy px-4 py-2 text-sm text-white">+ New story</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Nothing publishes without approval. The &quot;suggested&quot; column arrives with the Content OS (module 6).
      </p>

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
                    <Link href={`/console/stories/${s.id}`} className="font-medium leading-snug hover:text-steel">{s.title}</Link>
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
                        <button className="text-gray-400 hover:text-navy">
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
    </div>
  );
}
