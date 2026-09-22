import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { mustList } from "@/lib/db/must";
import { markAllInboxRead, markInboxRead } from "../actions";

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
  const { data: messages, count } = await mustList(
    q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    "console/messages list",
  );

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams({ filter, ...(kind ? { kind } : {}) });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/console/messages?${params.toString()}`;
  };

  // Unread across the current kind filter, so the button's count matches what
  // clearing it will actually touch.
  let unreadQ = serviceDb().from("inbox_messages").select("*", { count: "exact", head: true }).eq("read", false);
  if (kind) unreadQ = unreadQ.eq("kind", kind);
  const { count: unread } = await mustList(unreadQ, "console/messages unread count");

  const total = count ?? 0;
  const hasNext = page * PAGE_SIZE < total;
  const hasPrev = page > 1;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">Messages</h1>
        {/* Not on the Read tab: there it would offer to clear messages the list
            is not showing, which reads as a bug even though the count is right. */}
        {Boolean(unread) && filter !== "read" && (
          <form action={markAllInboxRead}>
            {kind && <input type="hidden" name="kind" value={kind} />}
            <button type="submit" className="text-sm text-graphite underline hover:text-ink">
              Mark all {kind ? `${kind} ` : ""}as read ({unread})
            </button>
          </form>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 border-b text-sm">
          {FILTER_TABS.map((t) => (
            <Link
              key={t.key}
              href={qs({ filter: t.key, page: undefined })}
              aria-current={t.key === filter ? "true" : undefined}
              className={`rounded-t px-4 py-2 ${t.key === filter ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
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
              aria-current={(kind ?? "all") === t.key ? "true" : undefined}
              className={`rounded px-3 py-1 ${(kind ?? "all") === t.key ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-b-xl rounded-tr-xl bg-white shadow-sm">
        {(messages ?? []).length === 0 && <p className="p-5 text-sm text-graphite">No messages.</p>}
        <ul className="divide-y">
          {(messages ?? []).map((m) => (
            <li key={m.id} className="relative p-4 text-sm transition hover:bg-shade/50">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-xs uppercase text-brand-text">{m.kind}</span>
                <b>{m.name}</b>
                <span className="text-graphite">&lt;{m.email}&gt;</span>
                <span className="ml-auto text-xs text-graphite">{fmt(m.created_at)}</span>
                {/* z-10 keeps the button clickable above the row's stretched link */}
                <form action={markInboxRead} className="z-10">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="read" value={m.read ? "0" : "1"} />
                  <button className="relative text-xs text-graphite underline hover:text-ink">
                    {m.read ? "mark unread" : "mark read"}
                  </button>
                </form>
              </div>
              {/* The whole row opens the message — full text and reply live there. */}
              <Link href={`/console/messages/${m.id}`} className="mt-1 block text-graphite after:absolute after:inset-0">
                <span className="line-clamp-2">{m.message}</span>
                <span className="sr-only"> — open message from {m.name}</span>
              </Link>
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
