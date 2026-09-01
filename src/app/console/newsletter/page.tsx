import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { monthGrid, parseMonth } from "@/lib/calendar";
import { createIssue, scheduleIssue, sendIssue, unscheduleIssue } from "../actions";
import { CalendarView, type CalendarIssue } from "./CalendarView";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { key: "draft", label: "Draft" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  // A failed send has to live somewhere visible. Before this state existed the
  // issue was marked sent regardless of what happened (GAPS C3).
  { key: "send_failed", label: "Failed" },
] as const;

const TABS = [
  { view: "board", label: "Board" },
  { view: "calendar", label: "Calendar" },
] as const;

const ISSUE_SELECT = "id, number, subject, status, scheduled_at, sent_at, web_slug, send_error";

export default async function NewsletterPage(props: PageProps<"/console/newsletter">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "calendar" ? "calendar" : "board";
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  const { start, end } = monthGrid(month);
  const [{ data: issues }, { data: stories }, { data: videos }, { count: subscribers }] = await Promise.all([
    view === "calendar"
      ? db.from("newsletter_issues").select(ISSUE_SELECT).or(
          `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
          `and(status.eq.sent,sent_at.gte.${start.toISOString()},sent_at.lt.${end.toISOString()})`,
        )
      : db.from("newsletter_issues").select(ISSUE_SELECT).order("number", { ascending: false }),
    db.from("stories").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
    db.from("videos").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true).is("unsubscribed_at", null),
  ]);

  const byStatus = (s: string) => (issues ?? []).filter((x) => x.status === s);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-ink">Newsletter</h1>
      <p className="mt-1 text-sm text-gray-500">
        {subscribers ?? 0} clean subscribers. Unsubscribes sync back to the CRM and are never re-added.
        Issues send via Resend and are only marked sent once Resend accepts them.
      </p>

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Compose next issue</h2>
        <form action={createIssue} className="mt-3 space-y-3 text-sm">
          <input name="subject" placeholder="Subject" required className="w-full rounded border px-3 py-2" />
          <textarea name="intro" placeholder="Intro paragraph" rows={2} className="w-full rounded border px-3 py-2" />
          <p className="text-xs uppercase tracking-wide text-gray-500">Pick ~8 stories</p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
            {(stories ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" name="stories" value={s.id} />
                <span>{s.title}</span>
                <span className="text-xs text-gray-500">{s.published_at?.slice(0, 10)}</span>
              </label>
            ))}
          </div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Pick a video (optional)</p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
            {(videos ?? []).map((v) => (
              <label key={v.id} className="flex items-center gap-2">
                <input type="checkbox" name="videos" value={v.id} />
                <span>{v.title}</span>
                <span className="text-xs text-gray-500">{v.published_at?.slice(0, 10)}</span>
              </label>
            ))}
            {!videos?.length && <p className="text-xs text-gray-500">No published videos yet.</p>}
          </div>
          <button className="rounded bg-ink px-4 py-2 text-white">Create draft</button>
          <p className="text-xs text-gray-500">Advert slots attach from the issue&apos;s own page once it&apos;s created — open a draft below to add ~2–3.</p>
        </form>
      </section>

      <div className="mt-6 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/newsletter" : "/console/newsletter?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView month={month} issues={(issues ?? []) as CalendarIssue[]} />
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.key);
            return (
              <div key={col.key} className="rounded-xl bg-white p-3 shadow-sm">
                <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-gray-500">
                  {col.label} <span className="text-gray-500">({items.length})</span>
                </h2>
                <div className="mt-2 space-y-2">
                  {items.map((i) => (
                    <div key={i.id} className="rounded border p-2.5 text-sm">
                      <Link href={`/console/newsletter/${i.id}`} className="font-medium leading-snug hover:text-graphite hover:underline">#{i.number} — {i.subject}</Link>
                      {i.status === "scheduled" && i.scheduled_at && (
                        <p className="mt-1 text-xs text-gray-500">{new Date(i.scheduled_at).toLocaleString("en-GB")}</p>
                      )}
                      {i.status === "sent" && i.sent_at && (
                        <p className="mt-1 text-xs text-green-600">sent {i.sent_at.slice(0, 10)}</p>
                      )}
                      {i.web_slug && i.status === "sent" && (
                        <Link href={`/newsletters/${i.web_slug}`} className="mt-1 block text-xs text-graphite hover:underline">web version</Link>
                      )}

                      {i.status === "draft" && (
                        <div className="mt-2 space-y-2">
                          <form action={sendIssue}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-ink">Send now</button>
                          </form>
                          <form action={scheduleIssue} className="flex items-center gap-1.5">
                            <input type="hidden" name="id" value={i.id} />
                            <input type="datetime-local" name="scheduled_at" required className="rounded border px-1.5 py-1 text-xs" />
                            <button className="rounded border px-2.5 py-1 text-xs">Schedule</button>
                          </form>
                        </div>
                      )}
                      {i.status === "scheduled" && (
                        <div className="mt-2 flex gap-2">
                          <form action={sendIssue}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-ink">Send now</button>
                          </form>
                          <form action={unscheduleIssue}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="rounded border px-2.5 py-1 text-xs text-gray-500">Unschedule</button>
                          </form>
                        </div>
                      )}
                      {i.status === "send_failed" && (
                        <div className="mt-2 space-y-2">
                          {i.send_error && <p className="rounded bg-red-50 p-1.5 text-xs text-red-700">{i.send_error}</p>}
                          <form action={sendIssue}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-ink">Try again</button>
                          </form>
                        </div>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-gray-500">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
