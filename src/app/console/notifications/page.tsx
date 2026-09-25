import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { mustList } from "@/lib/db/must";
import {
  consoleNotificationHref,
  inboxKindLabel,
  INBOX_MESSAGE_KINDS,
  INBOX_NOTIFICATION_KINDS,
  type InboxPayload,
} from "@/lib/console-notification-links";
import { markAllInboxRead, markInboxRead } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const PAGE_SIZE = 30;

const FILTER_TABS = [
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
  { key: "all", label: "All" },
] as const;

/**
 * The primary split (fix-list 71). A message is something a person sent and is
 * waiting on an answer to; a notification is a receipt for something that
 * happened. They were one list, and the reply form was offered on both.
 */
const CATEGORY_TABS = [
  { key: "all", label: "All" },
  { key: "message", label: "Messages" },
  { key: "notification", label: "Notifications" },
] as const;

/**
 * Kind chips, scoped to whichever category is showing.
 *
 * This is also where an old bug is fixed: the kind tabs used to be a hard-coded
 * `contact | advertising` pair, so `membership` rows — every message a member
 * sent from the Help page or a "request a change" — had no tab of their own and
 * were reachable only under "All". The lists now come from the kind vocabulary
 * itself, so a kind cannot be added without a way to filter on it.
 */
const KINDS_BY_CATEGORY = {
  message: INBOX_MESSAGE_KINDS,
  notification: INBOX_NOTIFICATION_KINDS,
} as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function NotificationsPage(props: PageProps<"/console/notifications">) {
  await requireConsole();
  const sp = await props.searchParams;
  const filter = sp.filter === "read" || sp.filter === "all" ? sp.filter : "unread";
  const category = sp.category === "message" || sp.category === "notification" ? sp.category : undefined;
  // A kind is only honoured inside its own category, so a stale bookmark like
  // ?category=message&kind=story_submitted cannot produce an empty list with two
  // filters lit up and no explanation.
  const kindOptions: readonly string[] = category ? KINDS_BY_CATEGORY[category] : [];
  const kind = typeof sp.kind === "string" && kindOptions.includes(sp.kind) ? sp.kind : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  let q = serviceDb().from("inbox_messages").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (filter !== "all") q = q.eq("read", filter === "read");
  if (category) q = q.eq("category", category);
  if (kind) q = q.eq("kind", kind);
  const { data: rows, count } = await mustList(
    q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    "console/notifications list",
  );

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams({
      filter,
      ...(category ? { category } : {}),
      ...(kind ? { kind } : {}),
    });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/console/notifications?${params.toString()}`;
  };

  // Unread across the current filters, so the button's count matches what
  // clearing it will actually touch.
  let unreadQ = serviceDb().from("inbox_messages").select("*", { count: "exact", head: true }).eq("read", false);
  if (category) unreadQ = unreadQ.eq("category", category);
  if (kind) unreadQ = unreadQ.eq("kind", kind);
  const { count: unread } = await mustList(unreadQ, "console/notifications unread count");

  const total = count ?? 0;
  const hasNext = page * PAGE_SIZE < total;
  const hasPrev = page > 1;
  const scopeLabel = kind ? inboxKindLabel(kind).toLowerCase() : category === "message" ? "messages" : category === "notification" ? "notifications" : "";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">Notifications</h1>
        {/* Not on the Read tab: there it would offer to clear rows the list is
            not showing, which reads as a bug even though the count is right. */}
        {Boolean(unread) && filter !== "read" && (
          <form action={markAllInboxRead}>
            {category && <input type="hidden" name="category" value={category} />}
            {kind && <input type="hidden" name="kind" value={kind} />}
            <button type="submit" className="text-sm text-graphite underline hover:text-ink">
              Mark all {scopeLabel && `${scopeLabel} `}as read ({unread})
            </button>
          </form>
        )}
      </div>
      <p className="mt-1 text-sm text-graphite">
        Messages are from people and need an answer. Notifications are things that happened and link to what they are about.
      </p>

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
          {CATEGORY_TABS.map((t) => (
            <Link
              key={t.key}
              // Changing category drops the kind: a message kind means nothing
              // under notifications and the other way round.
              href={qs({ category: t.key === "all" ? undefined : t.key, kind: undefined, page: undefined })}
              aria-current={(category ?? "all") === t.key ? "true" : undefined}
              className={`rounded px-3 py-1 ${(category ?? "all") === t.key ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {kindOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <Link
            href={qs({ kind: undefined, page: undefined })}
            aria-current={kind ? undefined : "true"}
            className={`rounded-full px-2.5 py-1 ${kind ? "bg-white text-graphite hover:text-ink" : "bg-brand text-ink"}`}
          >
            Any type
          </Link>
          {kindOptions.map((k) => (
            <Link
              key={k}
              href={qs({ kind: k, page: undefined })}
              aria-current={kind === k ? "true" : undefined}
              className={`rounded-full px-2.5 py-1 ${kind === k ? "bg-brand text-ink" : "bg-white text-graphite hover:text-ink"}`}
            >
              {inboxKindLabel(k)}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-b-xl rounded-tr-xl bg-white shadow-sm">
        {(rows ?? []).length === 0 && (
          <p className="p-5 text-sm text-graphite">
            {filter === "unread" ? "Nothing unread here." : "Nothing here."}
          </p>
        )}
        <ul className="divide-y">
          {(rows ?? []).map((m) => {
            const isMessage = m.category === "message";
            const href = isMessage ? null : consoleNotificationHref(m.kind, (m.payload ?? {}) as InboxPayload);
            return (
              <li key={m.id} className={`relative p-4 text-sm transition hover:bg-shade/50 ${m.read ? "" : "border-l-2 border-brand"}`}>
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-xs uppercase text-brand-text">{inboxKindLabel(m.kind)}</span>
                  <b>{m.name}</b>
                  {/* Notifications have no correspondent, so no empty <> pair. */}
                  {m.email && <span className="text-graphite">&lt;{m.email}&gt;</span>}
                  {m.replied_at && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Replied</span>
                  )}
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

                {isMessage ? (
                  // The whole row opens it — full text and the reply live there.
                  <Link href={`/console/notifications/${m.id}`} className="mt-1 block text-graphite after:absolute after:inset-0">
                    <span className="line-clamp-2">{m.message}</span>
                    <span className="sr-only"> — open message from {m.name}</span>
                  </Link>
                ) : (
                  <>
                    <p className="mt-1 text-graphite"><span className="line-clamp-2">{m.message}</span></p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
                      {href ? (
                        // A POST, not a link, on purpose: it marks the row read
                        // AND lands on the thing in one click. A plain link
                        // would leave every notification Jas has acted on
                        // sitting in the unread count for ever.
                        <form action={markInboxRead}>
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="read" value="1" />
                          <input type="hidden" name="next" value={href} />
                          <button className="text-xs font-semibold text-brand-text underline hover:text-ink">
                            Open it →
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-graphite">Nothing to open.</span>
                      )}
                      <Link href={`/console/notifications/${m.id}`} className="text-xs text-graphite underline hover:text-ink">
                        Details
                      </Link>
                    </div>
                  </>
                )}
              </li>
            );
          })}
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
