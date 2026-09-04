import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { decideMachine } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Featured Machine" };

const BADGE: Record<string, string> = {
  awaiting_approval: "bg-brand/20 text-brand",
  published: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  draft: "bg-shade text-graphite",
};

export default async function MachinesPage() {
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: machines }, { data: placements }] = await Promise.all([
    db.from("featured_machines").select("id, name, status, source, image_path, rejected_reason, member:members(name)").order("created_at", { ascending: false }),
    db.from("placements").select("featured_machine_id, starts_on, ends_on").eq("kind", "featured_machine").gte("ends_on", today),
  ]);
  const placed = new Map((placements ?? []).map((p) => [p.featured_machine_id, p]));
  const queue = (machines ?? []).filter((m) => m.status === "awaiting_approval");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Featured Machine</h1>
        <Link href="/console/machines/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New machine</Link>
      </div>

      {queue.length > 0 && (
        <section className="mt-4 rounded-xl border-2 border-brand bg-brand/5 p-4">
          <h2 className="font-bold text-ink">Awaiting approval ({queue.length})</h2>
          <div className="mt-2 space-y-2">
            {queue.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded bg-white p-3 text-sm shadow-sm">
                <Link href={`/console/machines/${m.id}`} className="font-medium text-ink hover:underline">{m.name}</Link>
                <span className="text-graphite">{m.member?.name}</span>
                <div className="ml-auto flex gap-2">
                  <form action={decideMachine}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <button className="rounded bg-success px-3 py-1.5 text-white">Approve</button>
                  </form>
                  <form action={decideMachine} className="flex gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <input name="reason" placeholder="Reason" aria-label={`Reason for rejecting ${m.name}`} required className="w-36 rounded border px-2 py-1" />
                    <button className="rounded border border-danger/30 px-2 py-1 text-danger">Reject</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4 space-y-2">
        {(machines ?? []).map((m) => {
          const p = placed.get(m.id);
          return (
            <Link key={m.id} href={`/console/machines/${m.id}`} className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm hover:shadow">
              {m.image_path && <Image src={mediaUrl(m.image_path)!} alt="" width={64} height={48} className="rounded object-cover" unoptimized />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{m.name}</p>
                <p className="text-xs text-graphite">{m.member?.name}{m.source === "member" && " · member submission"}</p>
              </div>
              {p && <span className="text-xs text-graphite">Featured {p.starts_on} → {p.ends_on}</span>}
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${BADGE[m.status] ?? ""}`}>{m.status.replace("_", " ")}</span>
            </Link>
          );
        })}
        {(machines ?? []).length === 0 && <p className="mt-6 text-sm text-graphite">No machines yet.</p>}
      </div>
    </div>
  );
}
