import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { requireDeveloper } from "@/lib/developer";
import { UUID_RE } from "@/lib/validate";
import { Badge, Card } from "@/components/console/ui";
import { setErrorStatus } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Error" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });

/** One error and its latest occurrences — developer-only (see ../page.tsx). */
export default async function ErrorDetailPage(props: PageProps<"/console/errors/[id]">) {
  await requireDeveloper();
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();
  const [event, occurrences] = await Promise.all([
    must(db.from("error_events").select("*").eq("id", id).maybeSingle(), "console/errors detail"),
    must(
      db.from("error_occurrences").select("id, occurred_at, path, digest, user_id, context").eq("event_id", id).order("occurred_at", { ascending: false }).limit(50),
      "console/errors occurrences",
    ),
  ]);
  if (!event) notFound();

  const actions = [
    { status: "resolved", label: "Resolve", show: event.status !== "resolved" },
    { status: "ignored", label: "Ignore", show: event.status !== "ignored" },
    { status: "open", label: "Reopen", show: event.status !== "open" },
  ].filter((a) => a.show);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/console/errors" className="text-sm text-graphite hover:text-ink">← Errors</Link>
      <h1 className="mt-1 break-words text-xl font-bold text-ink">{event.message}</h1>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-graphite">
        <Badge>{event.source}</Badge>
        <Badge tone={event.status === "open" ? "red" : event.status === "resolved" ? "green" : "neutral"}>{event.status}</Badge>
        <code>{event.area}</code>
        <span>· {event.count} occurrence{event.count === 1 ? "" : "s"}</span>
        <span>· first {when(event.first_seen)}</span>
        <span>· last {when(event.last_seen)}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => (
          <form key={a.status} action={setErrorStatus}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="status" value={a.status} />
            <button className="rounded border bg-white px-3 py-1.5 text-sm hover:border-ink">{a.label}</button>
          </form>
        ))}
      </div>
      <p className="mt-1 text-xs text-graphite">
        A resolved error that happens again reopens and alerts again. An ignored one is still counted, but never alerts.
      </p>

      {event.stack && (
        <Card className="mt-4">
          <h2 className="font-bold text-ink">Stack</h2>
          <pre className="mt-2 overflow-x-auto whitespace-pre text-xs leading-relaxed text-ink">{event.stack}</pre>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="font-bold text-ink">Latest occurrences</h2>
        <p className="text-xs text-graphite">The newest 50 are kept.</p>
        <ul className="mt-2 divide-y text-sm">
          {(occurrences ?? []).map((o) => (
            <li key={o.id} className="py-2">
              <p className="flex flex-wrap gap-x-3 text-graphite">
                <span className="text-ink">{when(o.occurred_at)}</span>
                {o.path && <code>{o.path}</code>}
                {o.digest && <span>digest <code>{o.digest}</code></span>}
                {o.user_id && <span>user <code>{o.user_id}</code></span>}
              </p>
              {o.context && Object.keys(o.context as object).length > 0 && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-graphite">{JSON.stringify(o.context, null, 2)}</pre>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
