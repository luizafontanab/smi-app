import Link from "next/link";
import { RENDERABLE_BOOKING_STATUSES } from "@/lib/adverts";
import { serviceDb } from "@/lib/db/server";
import { Badge, Card, SectionTitle, Stat } from "@/components/console/ui";
import { FEATURED_SLOTS, MEMBERSHIP_MONTHLY_PENNIES, pounds, revenueByStream } from "@/lib/pricing";
import { monthGrid, monthKey, parseMonth } from "@/lib/calendar";
import { OverviewCalendar, type OverviewItem } from "./OverviewCalendar";
import { decideRevision, markInboxRead } from "./actions";

export const dynamic = "force-dynamic";

export default async function CommandCentre(props: PageProps<"/console">) {
  const db = serviceDb();
  const sp = await props.searchParams;
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const { start, end } = monthGrid(month);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const weekOut = new Date(now + 7 * 864e5).toISOString().slice(0, 10);

  const [
    members,
    liveBookings,
    pendingStories,
    pendingEvents,
    pendingAdverts,
    pendingArtworkSwaps,
    pendingRevisions,
    expiring,
    graceMembers,
    draftMembers,
    deadJobs,
    oldestOpenJob,
    inbox,
    draftIssue,
    failedIssues,
    subscribers,
    featuredSold,
    draftStories,
    scheduledStories,
    publishedStories,
    sessions,
    lastSent,
    pendingVideos,
    draftVideos,
    scheduledVideos,
    publishedVideosCount,
    calStories,
    calVideos,
    calIssues,
    calEvents,
  ] = await Promise.all([
    db.from("members").select("*", { count: "exact", head: true }).eq("status", "active"),
    db.from("advert_bookings").select("advert:adverts(format, member_id), product:advert_products(rate_pennies)").in("status", RENDERABLE_BOOKING_STATUSES).lte("starts_on", today).gte("ends_on", today),
    db.from("stories").select("id, title, member:members(name)").eq("status", "awaiting_approval"),
    db.from("events").select("id, title, member:members(name)").eq("status", "awaiting_approval"),
    db.from("advert_bookings").select("id, advert:adverts(name)").eq("status", "awaiting_approval"),
    db.from("advert_artwork_proposals").select("id, advert:adverts(name)").eq("status", "pending"),
    db.from("member_revisions").select("id, member:members(name)").eq("status", "awaiting_approval"),
    db.from("advert_bookings").select("id, ends_on, advert:adverts(name)").eq("status", "live").gte("ends_on", today).lte("ends_on", weekOut),
    db.from("members").select("id, name").eq("status", "grace"),
    db.from("members").select("id, name, draft_submitted_at").eq("status", "draft"),
    db.from("jobs").select("id, kind, last_error").eq("status", "dead"),
    db.from("jobs").select("due_at").in("status", ["pending", "running"]).order("due_at").limit(1),
    db.from("inbox_messages").select("id, kind, name, email, message").eq("read", false).order("created_at", { ascending: false }).limit(5),
    db.from("newsletter_issues").select("id, number").eq("status", "draft").limit(1),
    db.from("newsletter_issues").select("id, number, send_error").eq("status", "send_failed"),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true),
    db.from("placements").select("*", { count: "exact", head: true }).eq("kind", "featured_member").lte("starts_on", today).gte("ends_on", today),
    db.from("stories").select("*", { count: "exact", head: true }).eq("status", "draft"),
    db.from("stories").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    db.from("stories").select("*", { count: "exact", head: true }).eq("status", "published"),
    db.rpc("site_sessions_last_year"),
    db.from("newsletter_issues").select("number, sent_at").eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
    db.from("videos").select("id, title, member:members(name)").eq("status", "awaiting_approval"),
    db.from("videos").select("*", { count: "exact", head: true }).eq("status", "draft"),
    db.from("videos").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    db.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"),
    db.from("stories").select("id, title, status, scheduled_at, published_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.published,published_at.gte.${startIso},published_at.lt.${endIso})`,
    ),
    db.from("videos").select("id, title, status, scheduled_at, published_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.published,published_at.gte.${startIso},published_at.lt.${endIso})`,
    ),
    db.from("newsletter_issues").select("id, number, subject, status, scheduled_at, sent_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.sent,sent_at.gte.${startIso},sent_at.lt.${endIso})`,
    ),
    db.from("events").select("id, title, status, starts_on, starts_time")
      .in("status", ["draft", "awaiting_approval", "published"])
      .gte("starts_on", startDate)
      .lt("starts_on", endDate),
  ]);

  const live = liveBookings.data ?? [];
  const liveBanners = live.filter((b) => b.advert?.format === "banner").length;
  const liveLogos = live.filter((b) => b.advert?.format === "supplier_logo").length;
  const advertisers = new Set(live.map((b) => b.advert?.member_id).filter(Boolean)).size;
  const slotsSold = featuredSold.count ?? 0;

  const revenue = revenueByStream({
    activeMembers: members.count ?? 0,
    liveBookings: live.map((b) => ({ format: b.advert?.format ?? null, productPennies: b.product?.rate_pennies ?? null })),
    featuredSold: slotsSold,
  });
  const maxStream = Math.max(revenue.membership, revenue.advertising, revenue.featured);

  // Rendered as "—" until the site_sessions migration is applied.
  const sessionCount = Number(sessions.data);
  const siteUsers = sessions.error || sessions.data == null || !Number.isFinite(sessionCount) ? null : sessionCount;

  const issueSent = lastSent.data?.[0];
  const dateLabel = new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const fmtTime = (t: string) => {
    const [h, m] = t.split(":");
    return new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const monthParam = monthKey(month);
  const overviewItems: OverviewItem[] = [
    ...(calStories.data ?? []).map((s) => ({
      id: s.id,
      type: "story" as const,
      title: s.title,
      date: new Date((s.status === "published" ? s.published_at : s.scheduled_at)!),
      href: `/console/stories/${s.id}?from=calendar&month=${monthParam}`,
    })),
    ...(calVideos.data ?? []).map((v) => ({
      id: v.id,
      type: "video" as const,
      title: v.title,
      date: new Date((v.status === "published" ? v.published_at : v.scheduled_at)!),
      href: `/console/videos/${v.id}?from=calendar&month=${monthParam}`,
    })),
    ...(calIssues.data ?? []).map((i) => ({
      id: i.id,
      type: "newsletter" as const,
      title: `#${i.number} — ${i.subject}`,
      date: new Date((i.status === "sent" ? i.sent_at : i.scheduled_at)!),
      href: "/console/newsletter?view=board",
    })),
    ...(calEvents.data ?? []).map((e) => ({
      id: e.id,
      type: "event" as const,
      title: e.title,
      date: new Date(`${e.starts_on}T12:00:00Z`),
      time: e.starts_time ? fmtTime(e.starts_time) : null,
      href: `/console/events/${e.id}?from=calendar&month=${monthParam}`,
    })),
  ];

  const pipeline: { label: string; value: number | null }[] = [
    { label: "Suggested", value: null },
    { label: "Awaiting approval", value: pendingStories.data?.length ?? 0 },
    { label: "Drafts", value: draftStories.count ?? 0 },
    { label: "Scheduled", value: scheduledStories.count ?? 0 },
    { label: "Published", value: publishedStories.count ?? 0 },
  ];

  const videoPipeline: { label: string; value: number }[] = [
    { label: "Awaiting approval", value: pendingVideos.data?.length ?? 0 },
    { label: "Drafts", value: draftVideos.count ?? 0 },
    { label: "Scheduled", value: scheduledVideos.count ?? 0 },
    { label: "Published", value: publishedVideosCount.count ?? 0 },
  ];

  const needs: { label: string; href: string; urgent?: boolean }[] = [];
  if (pendingStories.data?.length) needs.push({ label: `${pendingStories.data.length} member stories awaiting your approval`, href: "/console/stories" });
  if (pendingVideos.data?.length) needs.push({ label: `${pendingVideos.data.length} member videos awaiting your approval`, href: "/console/videos" });
  if (pendingEvents.data?.length) needs.push({ label: `${pendingEvents.data.length} member events awaiting approval`, href: "/console/events" });
  if (pendingAdverts.data?.length) needs.push({ label: `${pendingAdverts.data.length} member adverts awaiting approval`, href: "/console/adverts" });
  if (pendingArtworkSwaps.data?.length) needs.push({ label: `${pendingArtworkSwaps.data.length} artwork swap${pendingArtworkSwaps.data.length === 1 ? "" : "s"} awaiting approval`, href: "/console/adverts" });
  if (pendingRevisions.data?.length) needs.push({ label: `${pendingRevisions.data.length} member page edits awaiting approval`, href: "#approvals" });
  if (expiring.data?.length) needs.push({ label: `${expiring.data.length} adverts expire within 7 days`, href: "/console/adverts" });
  if (graceMembers.data?.length) needs.push({ label: `${graceMembers.data.length} memberships lapsing (grace period)`, href: "/console/members" });
  const readyToReview = (draftMembers.data ?? []).filter((m) => m.draft_submitted_at);
  const midFunnel = (draftMembers.data ?? []).length - readyToReview.length;
  if (readyToReview.length) needs.push({ label: `${readyToReview.length} new member page${readyToReview.length === 1 ? "" : "s"} ready to review & activate`, href: "/console/members" });
  if (midFunnel) needs.push({ label: `${midFunnel} signup${midFunnel === 1 ? "" : "s"} part-way through joining (watch the inbox)`, href: "/console/members" });
  if (draftIssue.data?.length) needs.push({ label: `Newsletter issue ${draftIssue.data[0].number} is drafted but unsent`, href: "/console/newsletter" });
  // A send that failed halfway to the whole list is the most urgent thing on
  // this page — it used to be invisible, because the issue was marked sent
  // regardless of what the sender did (GAPS C3).
  for (const issue of failedIssues.data ?? []) {
    needs.push({ label: `⚠ Newsletter issue ${issue.number} failed to send${issue.send_error ? ` — ${issue.send_error}` : ""}`, href: "/console/newsletter", urgent: true });
  }
  if (deadJobs.data?.length) needs.push({ label: `⚠ ${deadJobs.data.length} background jobs failed and need attention`, href: "#jobs", urgent: true });
  // A job that's never picked up never fails, so it never dead-letters into the
  // check above — this is the only signal that catches cron not running at all
  // (e.g. CRON_SECRET unset), which the deadJobs check can't see.
  const oldestDueAt = oldestOpenJob.data?.[0]?.due_at;
  const STALE_JOB_MS = 15 * 60 * 1000;
  if (oldestDueAt && now - Date.parse(oldestDueAt) > STALE_JOB_MS) {
    const staleMinutes = Math.round((now - Date.parse(oldestDueAt)) / 60_000);
    needs.push({ label: `⚠ Background jobs haven't run in over ${staleMinutes} minutes — check CRON_SECRET / cron config`, href: "#jobs", urgent: true });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">Command Centre</h1>
      <p className="mt-1 text-sm text-gray-500">{dateLabel}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active members" value={String(members.count ?? 0)} sub={`${pounds(MEMBERSHIP_MONTHLY_PENNIES)}/mo each`} />
        <Stat label="Live advertisers" value={String(advertisers)} sub={`${liveBanners} banners · ${liveLogos} supplier logos`} />
        <Stat label="Newsletter subscribers" value={String(subscribers.count ?? 0)} sub={issueSent ? `issue ${issueSent.number} sent ${String(issueSent.sent_at).slice(0, 10)}` : "clean list"} />
        <Stat label="Site users (12 mo)" value={siteUsers === null ? "—" : siteUsers.toLocaleString("en-GB")} sub="distinct sessions, rolling year" />
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>Revenue this month</SectionTitle>
          <p className="text-xs text-gray-500">
            estimated from live bookings &amp; standard rates
            {revenue.unpriced > 0 && ` · ${revenue.unpriced} unpriced (not counted)`}
          </p>
        </div>
        <p className="mt-3 text-4xl font-bold text-ink">
          {pounds(revenue.total)}
          <span className="text-base font-normal text-gray-500"> / month</span>
        </p>
        <div className="mt-5 space-y-4">
          <RevenueBar label="Memberships" pennies={revenue.membership} max={maxStream} sub={`${members.count ?? 0} members × ${pounds(MEMBERSHIP_MONTHLY_PENNIES)}/mo`} />
          <RevenueBar label="Advertising" pennies={revenue.advertising} max={maxStream} sub={`${live.length} live bookings`} />
          <RevenueBar label="Featured member slots" pennies={revenue.featured} max={maxStream} sub={`${slotsSold} slot${slotsSold === 1 ? "" : "s"} sold`} />
        </div>
        <div className="mt-5 border-t border-black/5 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">Featured slot occupancy</span>
            <span className="text-xs text-gray-500">{slotsSold} of {FEATURED_SLOTS.cap} sold · {pounds(FEATURED_SLOTS.pennies)}/slot</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {Array.from({ length: FEATURED_SLOTS.cap }, (_, i) => (
              <div key={i} className={`h-2.5 flex-1 rounded-full ${i < slotsSold ? "bg-brand" : "bg-ink/10"}`} />
            ))}
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <SectionTitle>This month</SectionTitle>
        <OverviewCalendar month={month} items={overviewItems} />
      </Card>

      <Link href="/console/stories" className="group mt-6 block">
        <Card className="transition group-hover:shadow-md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle>Story pipeline</SectionTitle>
            <span className="text-xs text-graphite group-hover:underline">Open Story Engine →</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {pipeline.map((p) => (
              <div key={p.label} className={p.value === null ? "opacity-60" : ""}>
                <p className="text-xs uppercase tracking-wide text-gray-500">{p.label}</p>
                <p className="mt-0.5 text-xl font-bold text-ink">{p.value === null ? "—" : p.value}</p>
                {p.value === null && <Badge>module 6</Badge>}
              </div>
            ))}
          </div>
        </Card>
      </Link>

      <Link href="/console/videos" className="group mt-6 block">
        <Card className="transition group-hover:shadow-md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle>Video pipeline</SectionTitle>
            <span className="text-xs text-graphite group-hover:underline">Open Video Engine →</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {videoPipeline.map((p) => (
              <div key={p.label}>
                <p className="text-xs uppercase tracking-wide text-gray-500">{p.label}</p>
                <p className="mt-0.5 text-xl font-bold text-ink">{p.value}</p>
              </div>
            ))}
          </div>
        </Card>
      </Link>

      <Card className="mt-6">
        <SectionTitle>Needs you today</SectionTitle>
        {needs.length === 0 && <p className="mt-2 text-sm text-gray-500">Nothing urgent. Enjoy the moon. 🌕</p>}
        <ul className="mt-2 space-y-1.5">
          {needs.map((n) => (
            <li key={n.label}>
              <Link href={n.href} className={`text-sm hover:underline ${n.urgent ? "font-semibold text-red-600" : "text-graphite"}`}>→ {n.label}</Link>
            </li>
          ))}
        </ul>
      </Card>

      {pendingRevisions.data?.length ? (
        <Card id="approvals" className="mt-6">
          <SectionTitle>Quick approvals</SectionTitle>
          {pendingRevisions.data?.map((r) => (
            <div key={r.id} className="mt-2 flex items-center justify-between gap-3 rounded border p-3 text-sm">
              <span>Page edit from <b>{r.member?.name}</b></span>
              <span className="flex gap-2">
                <form action={decideRevision}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><button className="rounded bg-green-600 px-3 py-1 text-white">Approve</button></form>
                <form action={decideRevision}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><button className="rounded border px-3 py-1">Reject</button></form>
              </span>
            </div>
          ))}
        </Card>
      ) : null}

      {inbox.data?.length ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <SectionTitle>Inbox</SectionTitle>
            <Link href="/console/messages" className="text-xs text-graphite underline">View all →</Link>
          </div>
          {inbox.data.map((m) => (
            <div key={m.id} className="mt-2 rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p><b>{m.name}</b> <span className="text-gray-500">&lt;{m.email}&gt;</span> · <span className="text-xs uppercase text-brand">{m.kind}</span></p>
                <form action={markInboxRead}><input type="hidden" name="id" value={m.id} /><button className="text-xs text-gray-500 hover:text-ink">mark read</button></form>
              </div>
              <p className="mt-1 text-gray-600">{m.message}</p>
            </div>
          ))}
        </Card>
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

function RevenueBar({ label, sub, pennies, max }: { label: string; sub: string; pennies: number; max: number }) {
  // Single hue on purpose: three direct-labelled bars need no colour identity.
  const pct = max > 0 && pennies > 0 ? Math.max(2, Math.round((pennies / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink">{label}</span>
        <span className="font-semibold text-ink">{pounds(pennies)}</span>
      </div>
      <div className="mt-1 h-2.5 rounded-full bg-ink/10">
        <div className="h-2.5 rounded-full bg-ink/80" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
    </div>
  );
}
