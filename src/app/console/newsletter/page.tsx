import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { dayKey, monthGrid, parseMonth } from "@/lib/calendar";
import { formatLondon } from "@/lib/london-time";
import { createIssue, saveNewsletterFooter, scheduleIssue, sendIssue, unscheduleIssue } from "../actions";
import { DEFAULT_REASON_LINE, POSTAL_ADDRESS_MAX, readNewsletterFooter, REASON_LINE_MAX } from "@/lib/newsletter-footer";
import { CalendarView, type CalendarIssue } from "./CalendarView";
import { newsletterAudience } from "@/lib/newsletter-audience";
import { SubmitButton } from "@/components/SubmitButton";

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

const ISSUE_SELECT = "id, number, subject, status, scheduled_at, sent_at, web_slug, send_error, approved_at";

export default async function NewsletterPage(props: PageProps<"/console/newsletter">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "calendar" ? "calendar" : "board";
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  const { start, end } = monthGrid(month);
  const [issues, stories, videos, { count: subscribers }, footer] = await Promise.all([
    must(
      view === "calendar"
        ? db.from("newsletter_issues").select(ISSUE_SELECT).or(
            `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
            `and(status.eq.sent,sent_at.gte.${start.toISOString()},sent_at.lt.${end.toISOString()})`,
          )
        : db.from("newsletter_issues").select(ISSUE_SELECT).order("number", { ascending: false }),
      "console/newsletter issues",
    ),
    must(db.from("stories").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20), "console/newsletter stories"),
    must(db.from("videos").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20), "console/newsletter videos"),
    // head:true — the count is the only thing this one returns.
    mustList(newsletterAudience(db), "console/newsletter subscriber count"),
    readNewsletterFooter(db),
  ]);

  const byStatus = (s: string) => (issues ?? []).filter((x) => x.status === s);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-ink">Newsletter</h1>
      <p className="mt-1 text-sm text-graphite">
        {subscribers ?? 0} clean subscribers. Unsubscribes sync back to the CRM and are never re-added.
        Issues send via Resend and are only marked sent once Resend accepts them.
      </p>

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Compose next issue</h2>
        <form action={createIssue} className="mt-3 space-y-3 text-sm">
          <input name="subject" placeholder="Subject" aria-label="Subject" required className="w-full rounded border px-3 py-2" />
          <textarea name="intro" placeholder="Intro paragraph" aria-label="Intro paragraph" rows={2} className="w-full rounded border px-3 py-2" />
          <p className="text-xs uppercase tracking-wide text-graphite">Pick ~8 stories</p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
            {(stories ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" name="stories" value={s.id} />
                <span>{s.title}</span>
                <span className="text-xs text-graphite">{s.published_at?.slice(0, 10)}</span>
              </label>
            ))}
          </div>
          <p className="text-xs uppercase tracking-wide text-graphite">Pick a video (optional)</p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
            {(videos ?? []).map((v) => (
              <label key={v.id} className="flex items-center gap-2">
                <input type="checkbox" name="videos" value={v.id} />
                <span>{v.title}</span>
                <span className="text-xs text-graphite">{v.published_at?.slice(0, 10)}</span>
              </label>
            ))}
            {!videos?.length && <p className="text-xs text-graphite">No published videos yet.</p>}
          </div>
          <SubmitButton pendingLabel="Creating…" className="rounded bg-ink px-4 py-2 text-white">Create draft</SubmitButton>
          <p className="text-xs text-graphite">Advert slots attach from the issue&apos;s own page once it&apos;s created — open a draft below to add ~2–3.</p>
        </form>
      </section>

      <div className="mt-6 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "board" ? "/console/newsletter" : "/console/newsletter?view=calendar"}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
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
                <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-graphite">
                  {col.label} <span className="text-graphite">({items.length})</span>
                </h2>
                <div className="mt-2 space-y-2">
                  {items.map((i) => (
                    <div key={i.id} className="rounded border p-2.5 text-sm">
                      <Link href={`/console/newsletter/${i.id}`} className="font-medium leading-snug hover:text-graphite hover:underline">#{i.number} — {i.subject}</Link>
                      {i.status === "scheduled" && i.scheduled_at && (
                        <p className="mt-1 text-xs text-graphite">{formatLondon(i.scheduled_at)}</p>
                      )}
                      {i.status === "sent" && i.sent_at && (
                        <p className="mt-1 text-xs text-success">sent {dayKey(new Date(i.sent_at))}</p>
                      )}
                      {i.web_slug && i.status === "sent" && (
                        <Link href={`/newsletters/${i.web_slug}`} className="mt-1 block text-xs text-graphite hover:underline">web version</Link>
                      )}

                      {i.status === "draft" && !i.approved_at && (
                        // Gap review area 4: nothing sends or schedules unapproved.
                        <Link href={`/console/newsletter/${i.id}`} className="mt-2 block text-xs font-semibold text-ink underline">
                          Needs proof and approval →
                        </Link>
                      )}
                      {i.status === "draft" && i.approved_at && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-success">Approved to send</p>
                          <SendNowForm id={i.id} label="Send now" />
                          <form action={scheduleIssue} className="flex flex-wrap items-center gap-1.5">
                            <input type="hidden" name="id" value={i.id} />
                            <input type="datetime-local" name="scheduled_at" aria-label="Schedule send time (UK time)" required className="max-w-full rounded border px-1.5 py-1 text-xs" />
                            <SubmitButton pendingLabel="Scheduling…" className="rounded border px-2.5 py-1 text-xs">Schedule</SubmitButton>
                          </form>
                        </div>
                      )}
                      {i.status === "scheduled" && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <SendNowForm id={i.id} label="Send now" />
                          <form action={unscheduleIssue}>
                            <input type="hidden" name="id" value={i.id} />
                            <SubmitButton pendingLabel="Unscheduling…" className="rounded border px-2.5 py-1 text-xs text-graphite">Unschedule</SubmitButton>
                          </form>
                        </div>
                      )}
                      {i.status === "send_failed" && (
                        <div className="mt-2 space-y-2">
                          {i.send_error && <p className="rounded bg-danger/10 p-1.5 text-xs text-danger">{i.send_error}</p>}
                          {i.approved_at ? (
                            <SendNowForm id={i.id} label="Try again" />
                          ) : (
                            <Link href={`/console/newsletter/${i.id}`} className="block text-xs font-semibold text-ink underline">
                              Needs proof and approval →
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-graphite">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section id="footer" className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Footer</h2>
        <p className="mt-1 text-xs text-graphite">
          Every issue&apos;s footer carries these, with the website, contact and social links, &quot;Update your details&quot; and the unsubscribe link. Changes reach every unsent issue; sent ones stay as they went.
        </p>
        {sp.footer === "saved" && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Footer saved.</p>}
        {typeof sp.footer_error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.footer_error}</p>}
        {!footer.postal_address && (
          <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">
            No postal address yet, so issues go out without one. The SOP (and PECR) expects it in every footer.
          </p>
        )}
        <form action={saveNewsletterFooter} className="mt-3 space-y-3 text-sm">
          <label className="block">
            Postal address
            <textarea name="postal_address" rows={3} maxLength={POSTAL_ADDRESS_MAX} defaultValue={footer.postal_address} placeholder={"Sheet Metal Industries\nStreet\nTown, Postcode"} className="mt-1 w-full rounded border px-3 py-2" />
            <span className="text-xs text-graphite">One part per line; the email shows it on one line, comma-separated.</span>
          </label>
          <label className="block">
            Why they&apos;re receiving it
            <textarea name="reason_line" rows={2} maxLength={REASON_LINE_MAX} defaultValue={footer.reason_line} className="mt-1 w-full rounded border px-3 py-2" />
            <span className="text-xs text-graphite">Left blank, it goes back to: &quot;{DEFAULT_REASON_LINE}&quot;</span>
          </label>
          <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-4 py-2 text-white">Save footer</SubmitButton>
        </form>
      </section>
    </div>
  );
}

/** Mails the whole list, so it takes the ticked "confirm" a delete does (checked server-side too). */
function SendNowForm({ id, label }: { id: string; label: string }) {
  return (
    <form action={sendIssue} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-1 text-xs text-graphite">
        <input type="checkbox" name="confirm" value="1" required />
        confirm
      </label>
      <SubmitButton pendingLabel="Sending…" className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-ink">{label}</SubmitButton>
    </form>
  );
}
