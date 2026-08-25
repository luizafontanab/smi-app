import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { createIssue, sendIssue } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewsletterPage() {
  await requireConsole();
  const db = serviceDb();
  const [{ data: issues }, { data: stories }, { count: subscribers }] = await Promise.all([
    db.from("newsletter_issues").select("id, number, subject, status, sent_at, web_slug").order("number", { ascending: false }),
    db.from("stories").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true).is("unsubscribed_at", null),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-ink">Newsletter</h1>
      <p className="mt-1 text-sm text-gray-500">
        {subscribers ?? 0} clean subscribers. Unsubscribes sync back to the CRM and are never re-added.
        Sender platform is behind the adapter pending the deliverability decision.
      </p>

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Compose next issue</h2>
        <form action={createIssue} className="mt-3 space-y-3 text-sm">
          <input name="subject" placeholder="Subject" required className="w-full rounded border px-3 py-2" />
          <textarea name="intro" placeholder="Intro paragraph" rows={2} className="w-full rounded border px-3 py-2" />
          <p className="text-xs uppercase tracking-wide text-gray-400">Pick ~8 stories</p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
            {(stories ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" name="stories" value={s.id} />
                <span>{s.title}</span>
                <span className="text-xs text-gray-400">{s.published_at?.slice(0, 10)}</span>
              </label>
            ))}
          </div>
          <button className="rounded bg-ink px-4 py-2 text-white">Create draft</button>
          <p className="text-xs text-gray-400">Advert slots attach from Adverts &amp; Inventory (2–3 per issue).</p>
        </form>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Issues</h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {(issues ?? []).map((i) => (
              <tr key={i.id} className="border-t">
                <td className="py-2 font-medium">#{i.number} — {i.subject}</td>
                <td>{i.status === "sent"
                  ? <span className="text-xs text-green-600">sent {i.sent_at?.slice(0, 10)}</span>
                  : <span className="text-xs text-brand">draft</span>}
                </td>
                <td className="text-right">
                  <span className="flex items-center justify-end gap-3">
                    {i.web_slug && i.status === "sent" && <Link href={`/newsletters/${i.web_slug}`} className="text-xs text-graphite hover:underline">web version</Link>}
                    {i.status === "draft" && (
                      <form action={sendIssue}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="rounded bg-brand px-3 py-1 text-xs font-semibold text-ink">Send + publish</button>
                      </form>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
