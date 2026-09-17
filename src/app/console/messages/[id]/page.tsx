import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { SubmitButton } from "@/components/SubmitButton";
import { markInboxRead, replyToInboxMessage } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message" };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function MessagePage(props: PageProps<"/console/messages/[id]">) {
  await requireConsole();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const db = serviceDb();
  const { data: m } = await db.from("inbox_messages").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();

  // Opening a message is reading it — same convention as any inbox. The
  // "mark unread" button below undoes it for triage.
  if (!m.read) await db.from("inbox_messages").update({ read: true }).eq("id", id);

  const suggestedSubject = `Re: your ${m.kind} enquiry to Sheet Metal Industries`;
  const error = typeof sp.error === "string" ? sp.error : null;
  const replied = typeof sp.replied === "string";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/messages" className="text-sm text-graphite hover:text-ink">← Messages</Link>
      <div className="mt-3 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs uppercase text-brand-text">{m.kind}</span>
          <h1 className="font-bold text-ink">{m.name}</h1>
          <span className="text-sm text-graphite">&lt;{m.email}&gt;</span>
          <span className="ml-auto text-xs text-graphite">{fmt(m.created_at)}</span>
        </div>
        {/* pre-wrap: enquiries arrive with real paragraph breaks — the list
            view collapses them, this page must not. */}
        <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{m.message}</p>
        <div className="mt-5 border-t pt-4">
          <form action={markInboxRead}>
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="read" value="0" />
            <input type="hidden" name="next" value="/console/messages" />
            <button className="text-sm text-graphite underline hover:text-ink">Mark unread</button>
          </form>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Reply</h2>
        {replied && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Reply sent.</p>}
        {error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
        <form action={replyToInboxMessage} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={m.id} />
          <div>
            <label htmlFor="subject" className="text-sm font-medium">Subject</label>
            <input
              id="subject" name="subject" required defaultValue={suggestedSubject}
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
    </div>
  );
}
