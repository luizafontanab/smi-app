import Link from "next/link";
import { serviceDb } from "@/lib/db/server";
import { mustList } from "@/lib/db/must";
import { requireDeveloper } from "@/lib/developer";
import { Pagination } from "@/components/Pagination";
import { Badge, Card } from "@/components/console/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Errors" };

const PAGE_SIZE = 30;
const STATUSES = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "ignored", label: "Ignored" },
] as const;
const SOURCES = ["server", "client", "job", "webhook", "adapter", "db"] as const;

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

/**
 * The error log (docs/logging.md) — developer-only: requireDeveloper() 404s
 * for any admin not on DEVELOPER_EMAILS, Jas included, by decision.
 */
export default async function ErrorsPage(props: PageProps<"/console/errors">) {
  await requireDeveloper();
  const sp = await props.searchParams;
  const status = STATUSES.some((s) => s.key === sp.status) ? (sp.status as string) : "open";
  const source = SOURCES.includes(sp.source as (typeof SOURCES)[number]) ? (sp.source as string) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  let q = serviceDb()
    .from("error_events")
    .select("id, source, area, message, count, first_seen, last_seen, status", { count: "exact" })
    .eq("status", status)
    .order("last_seen", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (source) q = q.eq("source", source);
  const { data: rows, count } = await mustList(q, "console/errors list");
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, source, page: undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `/console/errors?${s}` : "/console/errors";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold text-ink">Errors</h1>
      <p className="mt-1 text-sm text-graphite">
        Every recorded failure, grouped. Developer-only — kept 90 days. How it works: <code>docs/logging.md</code>.
      </p>

      <nav aria-label="Status" className="mt-4 flex flex-wrap gap-1 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s.key}
            href={qs({ status: s.key })}
            aria-current={status === s.key ? "page" : undefined}
            className={`rounded px-3 py-1 ${status === s.key ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}
          >
            {s.label}
          </Link>
        ))}
        <span className="mx-2 self-center text-graphite">·</span>
        <Link href={qs({ source: undefined })} aria-current={!source ? "page" : undefined} className={`rounded px-3 py-1 ${!source ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}>
          All sources
        </Link>
        {SOURCES.map((s) => (
          <Link key={s} href={qs({ source: s })} aria-current={source === s ? "page" : undefined} className={`rounded px-3 py-1 ${source === s ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}>
            {s}
          </Link>
        ))}
      </nav>

      <Card className="mt-4">
        {(rows ?? []).length === 0 ? (
          <p className="text-sm text-graphite">Nothing {status} here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th scope="col" className="py-2 pr-3">Count</th>
                  <th scope="col" className="py-2 pr-3">Error</th>
                  <th scope="col" className="py-2 pr-3">Last seen</th>
                  <th scope="col" className="py-2">First seen</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2 pr-3 font-semibold tabular-nums">{r.count}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/console/errors/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.message.slice(0, 140)}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-graphite">
                        <Badge>{r.source}</Badge>
                        <code>{r.area}</code>
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-graphite">{when(r.last_seen)}</td>
                    <td className="whitespace-nowrap py-2 text-graphite">{when(r.first_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: p })} />
    </div>
  );
}
