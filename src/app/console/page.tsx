import Link from "next/link";
import { serviceDb } from "@/lib/db/server";
import { decideEvent, decideRevision, markInboxRead } from "./actions";

export const dynamic = "force-dynamic";

export default async function CommandCentre() {
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const weekOut = new Date(now + 7 * 864e5).toISOString().slice(0, 10);

  const [members, advertBookings, pendingStories, pendingEvents, pendingRevisions, expiring, graceMembers, deadJobs, inbox, draftIssue, subscribers] = await Promise.all([
    db.from("members").select("*", { count: "exact", head: true }).eq("status", "active"),
    db.from("advert_bookings").select("*", { count: "exact", head: true }).lte("starts_on", today).gte("ends_on", today),
    db.from("stories").select("id, title, member:members(name)").eq("status", "awaiting_approval"),
    db.from("events").select("id, title, member:members(name)").eq("status", "awaiting_approval"),
    db.from("member_revisions").select("id, member:members(name)").eq("status", "awaiting_approval"),
    db.from("advert_bookings").select("id, ends_on, advert:adverts(name)").gte("ends_on", today).lte("ends_on", weekOut),
    db.from("members").select("id, name").eq("status", "grace"),
    db.from("jobs").select("id, kind, last_error").eq("status", "dead"),
    db.from("inbox_messages").select("id, kind, name, email, message").eq("read", false).limit(5),
    db.from("newsletter_issues").select("id, number").eq("status", "draft").limit(1),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true),
  ]);

  const revenue = {
    membership: (members.count ?? 0) * 40,
    advertising: (advertBookings.count ?? 0) * 650,
  };

  const needs: { label: string; href: string; urgent?: boolean }[] = [];
  if (pendingStories.data?.length) needs.push({ label: `${pendingStories.data.length} member stories awaiting your approval`, href: "/console/stories" });
  if (pendingEvents.data?.length) needs.push({ label: `${pendingEvents.data.length} member events awaiting approval`, href: "#approvals" });
  if (pendingRevisions.data?.length) needs.push({ label: `${pendingRevisions.data.length} member page edits awaiting approval`, href: "#approvals" });
  if (expiring.data?.length) needs.push({ label: `${expiring.data.length} adverts expire within 7 days`, href: "/console/adverts" });
  if (graceMembers.data?.length) needs.push({ label: `${graceMembers.data.length} memberships lapsing (grace period)`, href: "/console/members" });
  if (draftIssue.data?.length) needs.push({ label: `Newsletter issue ${draftIssue.data[0].number} is drafted but unsent`, href: "/console/newsletter" });
  if (deadJobs.data?.length) needs.push({ label: `⚠ ${deadJobs.data.length} background jobs failed and need attention`, href: "#jobs", urgent: true });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-navy">Command Centre</h1>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active members" value={String(members.count ?? 0)} sub={`£${revenue.membership.toLocaleString()}/mo`} />
        <Stat label="Live advert bookings" value={String(advertBookings.count ?? 0)} sub={`≈ £${revenue.advertising.toLocaleString()}/mo`} />
        <Stat label="Newsletter subscribers" value={String(subscribers.count ?? 0)} sub="clean list" />
        <Stat label="Est. monthly revenue" value={`£${(revenue.membership + revenue.advertising).toLocaleString()}`} sub="membership + advertising" />
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-navy">Needs you today</h2>
        {needs.length === 0 && <p className="mt-2 text-sm text-gray-500">Nothing urgent. Enjoy the moon. 🌕</p>}
        <ul className="mt-2 space-y-1.5">
          {needs.map((n) => (
            <li key={n.label}>
              <Link href={n.href} className={`text-sm hover:underline ${n.urgent ? "font-semibold text-red-600" : "text-steel"}`}>→ {n.label}</Link>
            </li>
          ))}
        </ul>
      </section>

      {(pendingEvents.data?.length || pendingRevisions.data?.length) ? (
        <section id="approvals" className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-navy">Quick approvals</h2>
          {pendingEvents.data?.map((e) => (
            <div key={e.id} className="mt-2 flex items-center justify-between gap-3 rounded border p-3 text-sm">
              <span>Event: <b>{e.title}</b> {e.member && <>— {e.member.name}</>}</span>
              <span className="flex gap-2">
                <form action={decideEvent}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="decision" value="approve" /><button className="rounded bg-green-600 px-3 py-1 text-white">Approve</button></form>
                <form action={decideEvent}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="decision" value="reject" /><button className="rounded border px-3 py-1">Reject</button></form>
              </span>
            </div>
          ))}
          {pendingRevisions.data?.map((r) => (
            <div key={r.id} className="mt-2 flex items-center justify-between gap-3 rounded border p-3 text-sm">
              <span>Page edit from <b>{r.member?.name}</b></span>
              <span className="flex gap-2">
                <form action={decideRevision}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><button className="rounded bg-green-600 px-3 py-1 text-white">Approve</button></form>
                <form action={decideRevision}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><button className="rounded border px-3 py-1">Reject</button></form>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {inbox.data?.length ? (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-navy">Inbox</h2>
          {inbox.data.map((m) => (
            <div key={m.id} className="mt-2 rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p><b>{m.name}</b> <span className="text-gray-400">&lt;{m.email}&gt;</span> · <span className="uppercase text-xs text-amber">{m.kind}</span></p>
                <form action={markInboxRead}><input type="hidden" name="id" value={m.id} /><button className="text-xs text-gray-400 hover:text-navy">mark read</button></form>
              </div>
              <p className="mt-1 text-gray-600">{m.message}</p>
            </div>
          ))}
        </section>
      ) : null}

      {deadJobs.data?.length ? (
        <section id="jobs" className="mt-6 rounded-xl border-2 border-red-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-red-600">Failed background jobs</h2>
          {deadJobs.data.map((j) => (
            <p key={j.id} className="mt-1 text-sm text-gray-600"><b>{j.kind}</b>: {j.last_error}</p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-navy">{value}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}
