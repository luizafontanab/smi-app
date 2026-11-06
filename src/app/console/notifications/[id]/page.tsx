import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { SubmitButton } from "@/components/SubmitButton";
import {
  consoleNotificationHref,
  inboxKindLabel,
  replySubjectFor,
  type InboxPayload,
} from "@/lib/console-notification-links";
import { markInboxRead, replyToInboxMessage } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification" };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function NotificationPage(props: PageProps<"/console/notifications/[id]">) {
  await requireConsole();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const db = serviceDb();
  // Screen a malformed id out before it reaches Postgres as an invalid uuid
  // (22P02) — must() would turn that into a thrown error, and a typo'd URL
  // should keep giving the 404 it always has.
  if (!UUID_RE.test(id)) notFound();
  const m = await must(db.from("inbox_messages").select("*").eq("id", id).maybeSingle(), "console/notifications detail");
  if (!m) notFound();

  // Opening it is reading it — same convention as any inbox. The "mark unread"
  // button below undoes it for triage.
  if (!m.read) await db.from("inbox_messages").update({ read: true }).eq("id", id);

  const replies = await must(
    db.from("inbox_replies").select("*").eq("message_id", id).order("created_at"),
    "console/notifications replies",
  );

  /**
   * Who a reply would go to. Two rows fail this and both used to offer the form
   * anyway (fix-list 71): a notification, which nobody sent, and the advert
   * expiry notice `jobs.ts` wrote with `email: ''` — replying to that one
   * addressed an email to nobody and the send failed silently downstream.
   */
  const canReply = m.category === "message" && Boolean(m.email);
  const href = m.category === "message" ? null : consoleNotificationHref(m.kind, (m.payload ?? {}) as InboxPayload);

  const error = typeof sp.error === "string" ? sp.error : null;
  const replied = typeof sp.replied === "string";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/notifications" className="text-sm text-graphite hover:text-ink">← Notifications</Link>
      <div className="mt-3 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs uppercase text-brand-text">{inboxKindLabel(m.kind)}</span>
          <h1 className="font-bold text-ink">{m.name}</h1>
          {m.email && <span className="text-sm text-graphite">&lt;{m.email}&gt;</span>}
          <span className="ml-auto text-xs text-graphite">{fmt(m.created_at)}</span>
        </div>
        {/* pre-wrap: enquiries arrive with real paragraph breaks — the list
            view collapses them, this page must not. */}
        <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{m.message}</p>
        {href && (
          <p className="mt-4">
            <Link href={href} className="inline-block rounded bg-ink px-4 py-2 text-sm text-white hover:opacity-90">
              Open what this is about →
            </Link>
          </p>
        )}
        <div className="mt-5 border-t pt-4">
          <form action={markInboxRead}>
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="read" value="0" />
            <input type="hidden" name="next" value="/console/notifications" />
            <SubmitButton className="text-sm text-graphite underline hover:text-ink" pendingLabel="Marking…">Mark unread</SubmitButton>
          </form>
        </div>
      </div>

      {/* The thread. Kept whether or not the send worked: a reply row is written
          before the send and stamped afterwards, so a provider rejection shows
          here with its reason instead of throwing the typed text away. */}
      {(replies ?? []).length > 0 && (
        <div className="mt-4 space-y-3">
          {(replies ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border-l-4 border-ink/20 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs uppercase text-graphite">Your reply</span>
                <b className="text-sm text-ink">{r.subject}</b>
                <span className="ml-auto text-xs text-graphite">{fmt(r.created_at)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{r.body}</p>
              {r.sent_at ? (
                <p className="mt-3 text-xs text-success">Sent {fmt(r.sent_at)}.</p>
              ) : (
                <p className="mt-3 text-xs text-danger">
                  Not delivered{r.delivery_error ? ` — ${r.delivery_error}` : ""}. The wording is kept above; send it again below.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {canReply ? (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Reply</h2>
          {replied && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Reply sent.</p>}
          {error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
          <form action={replyToInboxMessage} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={m.id} />
            <div>
              <label htmlFor="subject" className="text-sm font-medium">Subject</label>
              <input
                id="subject" name="subject" required defaultValue={replySubjectFor(m.kind)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="body" className="text-sm font-medium">Message</label>
              <textarea
                id="body" name="body" required rows={6}
                placeholder={`Hi ${m.name},\n\n`}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <SubmitButton pendingLabel="Sending…" className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50">
              Send reply
            </SubmitButton>
          </form>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-white p-5 text-sm text-graphite shadow-sm">
          {m.category === "message"
            ? "No email address came with this message, so there is nobody to reply to."
            : "Nobody sent this — it is a notification about something that happened, so there is nothing to reply to."}
        </p>
      )}
    </div>
  );
}
