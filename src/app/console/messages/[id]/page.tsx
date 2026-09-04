import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { markInboxRead } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message" };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function MessagePage(props: PageProps<"/console/messages/[id]">) {
  await requireConsole();
  const { id } = await props.params;
  const db = serviceDb();
  const { data: m } = await db.from("inbox_messages").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();

  // Opening a message is reading it — same convention as any inbox. The
  // "mark unread" button below undoes it for triage.
  if (!m.read) await db.from("inbox_messages").update({ read: true }).eq("id", id);

  const subject = encodeURIComponent(`Re: your ${m.kind} enquiry to Sheet Metal Industries`);

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
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
          <a
            href={`mailto:${m.email}?subject=${subject}`}
            className="rounded bg-ink px-4 py-2 text-white hover:bg-ink/90"
          >
            Reply by email
          </a>
          <form action={markInboxRead}>
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="read" value="0" />
            <input type="hidden" name="next" value="/console/messages" />
            <button className="text-graphite underline hover:text-ink">Mark unread</button>
          </form>
        </div>
      </div>
    </div>
  );
}
