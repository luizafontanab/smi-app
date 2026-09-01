import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { markInboxRead } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

const PAGE_SIZE = 30;

const FILTER_TABS = [
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
  { key: "all", label: "All" },
] as const;

const KIND_TABS = [
  { key: "all", label: "All" },
  { key: "contact", label: "Contact" },
  { key: "advertising", label: "Advertising" },
] as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function MessagesPage(props: PageProps<"/console/messages">) {
  await requireConsole();
  const sp = await props.searchParams;
  const filter = sp.filter === "read" || sp.filter === "all" ? sp.filter : "unread";
  const kind = sp.kind === "contact" || sp.kind === "advertising" ? sp.kind : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  let q = serviceDb().from("inbox_messages").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (filter !== "all") q = q.eq("read", filter === "read");
  if (kind) q = q.eq("kind", kind);
  const { data: messages, count } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams({ filter, ...(kind ? { kind } : {}) });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/console/messages?${params.toString()}`;
  };

  const total = count ?? 0;
  const hasNext = page * PAGE_SIZE < total;
  const hasPrev = page > 1;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Messages</h1>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 border-b text-sm">
          {FILTER_TABS.map((t) => (
            <Link
              key={t.key}
              href={qs({ filter: t.key, page: undefined })}
              className={`rounded-t px-4 py-2 ${t.key === filter ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-1 text-sm">
          {KIND_TABS.map((t) => (
            <Link
              key={t.key}
              href={qs({ kind: t.key === "all" ? undefined : t.key, page: undefined })}
              className={`rounded px-3 py-1 ${(kind ?? "all") === t.key ? "bg-ink text-white" : "bg-white text-gray-500 hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-b-xl rounded-tr-xl bg-white shadow-sm">
        {(messages ?? []).length === 0 && <p className="p-5 text-sm text-gray-500">No messages.</p>}
        <ul className="divide-y">
          {(messages ?? []).map((m) => (
            <li key={m.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-xs uppercase text-brand">{m.kind}</span>
                <b>{m.name}</b>
                <a href={`mailto:${m.email}`} className="text-gray-500 hover:text-ink">&lt;{m.email}&gt;</a>
                <span className="ml-auto text-xs text-gray-500">{fmt(m.created_at)}</span>
                <form action={markInboxRead}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="read" value={m.read ? "0" : "1"} />
                  <button className="text-xs text-gray-500 underline hover:text-ink">
                    {m.read ? "mark unread" : "mark read"}
                  </button>
                </form>
              </div>
              <p className="mt-1 text-gray-600">{m.message}</p>
            </li>
          ))}
        </ul>
      </div>

      {(hasPrev || hasNext) && (
        <div className="mt-3 flex justify-between text-sm">
          {hasPrev ? (
            <Link href={qs({ page: String(page - 1) })} className="text-graphite underline">← Previous</Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link href={qs({ page: String(page + 1) })} className="text-graphite underline">Next →</Link>
          )}
        </div>
      )}
    </div>
  );
}
