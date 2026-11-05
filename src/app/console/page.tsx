import Link from "next/link";
import { RENDERABLE_BOOKING_STATUSES } from "@/lib/adverts";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { Badge, Card, SectionTitle, Stat } from "@/components/console/ui";
import { FEATURED_SLOTS, MEMBERSHIP_MONTHLY_PENNIES, pounds, revenueByStream } from "@/lib/pricing";
import { dayKey, monthGrid, monthKey, parseMonth, shiftMonth } from "@/lib/calendar";
import { londonAt, londonDayStart } from "@/lib/london-time";
import { inboxKindLabel } from "@/lib/console-notification-links";
import { OverviewCalendar, type OverviewItem } from "./OverviewCalendar";
import { markInboxRead } from "./actions";
import { readSocialCaps } from "@/lib/social-push";
import { socialWaiting } from "@/lib/social-post";
import { waitingSummary } from "@/lib/social-confirm";

export const dynamic = "force-dynamic";

export default async function CommandCentre(props: PageProps<"/console">) {
  const db = serviceDb();
  const sp = await props.searchParams;
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const { start, end } = monthGrid(month);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  // GAPS A3.9: UK days throughout — `start`/`end` are UK midnights, and the
  // date-column bounds are the UK dates they fall on.
  const startDate = dayKey(start);
  const endDate = dayKey(end);
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const now = Date.now();
  const today = dayKey(new Date(now));
  const weekOut = dayKey(londonAt(new Date(now), 7, 12));
  // This UK calendar month for the revenue figure — the month it is now, not
  // the calendar's `?month=`. From UK midnight on the 1st to the next 1st.
  const thisMonth = parseMonth(today.slice(0, 7));
  const thisMonthStart = londonDayStart(thisMonth).toISOString();
  const nextMonthStart = londonDayStart(shiftMonth(thisMonth, 1)).toISOString();

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
    paidInvoices,
    unpaidInvoices,
    payingMembers,
  ] = await Promise.all([
    // Count-only reads go through mustList (the head:true ones keep their
    // `.count`); row reads go through must and come back as plain arrays. The
    // one exception is the sessions RPC, left raw on purpose — this page already
    // degrades it to "unknown" rather than failing.
    mustList(db.from("members").select("*", { count: "exact", head: true }).eq("status", "active"), "console/overview active members"),
    must(db.from("advert_bookings").select("advert:adverts(format, member_id)").in("status", RENDERABLE_BOOKING_STATUSES).lte("starts_on", today).gte("ends_on", today), "console/overview live bookings"),
    // Same order as the Story Engine board (most recently touched first —
    // editStory stamps updated_at on submit), so the queue reads the same in
    // both places; unordered, Postgres returned whatever order it liked.
    must(db.from("stories").select("id, title, member:members!stories_member_id_fkey(name)").eq("status", "awaiting_approval").order("updated_at", { ascending: false }), "console/overview pending stories"),
    must(db.from("events").select("id, title, member:members(name)").eq("status", "awaiting_approval"), "console/overview pending events"),
    must(db.from("advert_bookings").select("id, advert:adverts(name)").eq("status", "awaiting_approval"), "console/overview pending adverts"),
    must(db.from("advert_artwork_proposals").select("id, advert:adverts(name)").eq("status", "pending"), "console/overview pending artwork swaps"),
    must(db.from("member_revisions").select("id, member_id, member:members(name)").eq("status", "awaiting_approval").order("created_at"), "console/overview pending revisions"),
    must(db.from("advert_bookings").select("id, ends_on, advert:adverts(name)").eq("status", "live").gte("ends_on", today).lte("ends_on", weekOut), "console/overview expiring bookings"),
    must(db.from("members").select("id, name").eq("status", "grace"), "console/overview grace members"),
    must(db.from("members").select("id, name, draft_submitted_at").eq("status", "draft"), "console/overview draft members"),
    must(db.from("jobs").select("id, kind, last_error").eq("status", "dead"), "console/overview dead jobs"),
    must(db.from("jobs").select("due_at").in("status", ["pending", "running"]).order("due_at").limit(1), "console/overview oldest open job"),
    // Messages only (fix-list 71, her explicit instruction). This card is the
    // "someone is waiting on you" signal, and it stopped being that when eight
    // machine-written event notices started landing in the same table — five
    // "promo comp expired" rows would push every real enquiry off it.
    // Notifications have their own feed; the header bell counts both.
    must(db.from("inbox_messages").select("id, kind, name, email, message, replied_at").eq("category", "message").eq("read", false).order("created_at", { ascending: false }).limit(5), "console/overview inbox"),
    must(db.from("newsletter_issues").select("id, number").eq("status", "draft").limit(1), "console/overview draft issue"),
    must(db.from("newsletter_issues").select("id, number, send_error").eq("status", "send_failed"), "console/overview failed issues"),
    mustList(db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true), "console/overview subscriber count"),
    mustList(db.from("placements").select("*", { count: "exact", head: true }).eq("kind", "featured_member").eq("awaiting_payment", false).lte("starts_on", today).gte("ends_on", today), "console/overview featured slots sold"),
    // a member's unsubmitted draft is theirs, not the desk's (lib/story-board isMemberDraft)
    mustList(db.from("stories").select("*", { count: "exact", head: true }).eq("status", "draft").eq("member_draft", false), "console/overview draft stories"),
    mustList(db.from("stories").select("*", { count: "exact", head: true }).eq("status", "scheduled"), "console/overview scheduled stories"),
    mustList(db.from("stories").select("*", { count: "exact", head: true }).eq("status", "published"), "console/overview published stories"),
    // Left raw deliberately: the site-sessions RPC is optional telemetry, and
    // `sessions.error` is read below to show "—" instead of taking the page down.
    db.rpc("site_sessions_last_year"),
    must(db.from("newsletter_issues").select("number, sent_at").eq("status", "sent").order("sent_at", { ascending: false }).limit(1), "console/overview last sent issue"),
    must(db.from("videos").select("id, title, member:members(name)").eq("status", "awaiting_approval"), "console/overview pending videos"),
    mustList(db.from("videos").select("*", { count: "exact", head: true }).eq("status", "draft"), "console/overview draft videos"),
    mustList(db.from("videos").select("*", { count: "exact", head: true }).eq("status", "scheduled"), "console/overview scheduled videos"),
    mustList(db.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"), "console/overview published videos"),
    must(db.from("stories").select("id, title, status, scheduled_at, published_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.published,published_at.gte.${startIso},published_at.lt.${endIso})`,
    ), "console/overview calendar stories"),
    must(db.from("videos").select("id, title, status, scheduled_at, published_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.published,published_at.gte.${startIso},published_at.lt.${endIso})`,
    ), "console/overview calendar videos"),
    must(db.from("newsletter_issues").select("id, number, subject, status, scheduled_at, sent_at").or(
      `and(status.eq.scheduled,scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(status.eq.sent,sent_at.gte.${startIso},sent_at.lt.${endIso})`,
    ), "console/overview calendar issues"),
    must(db.from("events").select("id, title, status, starts_on, starts_time")
      .in("status", ["draft", "awaiting_approval", "published"])
      .gte("starts_on", startDate)
      .lt("starts_on", endDate), "console/overview calendar events"),
    // Revenue reads what was billed, not what is booked (lib/pricing revenueByStream).
    must(db.from("invoices").select("number, amount_pennies, placement:placements(kind)").eq("status", "paid").gte("paid_at", thisMonthStart).lt("paid_at", nextMonthStart), "console/overview invoices paid this month"),
    must(db.from("invoices").select("number, amount_pennies, placement:placements(kind)").eq("status", "issued"), "console/overview unpaid invoices"),
    // A comped member is active but pays nothing until comped_until has passed
    // (lib/membership applyPaymentResult "comped"), so isn't membership revenue.
    mustList(db.from("members").select("*", { count: "exact", head: true }).eq("status", "active").or(`comped_until.is.null,comped_until.lt.${today}`), "console/overview paying members"),
  ]);

  const live = liveBookings ?? [];
  const liveBanners = live.filter((b) => b.advert?.format === "banner").length;
  const liveLogos = live.filter((b) => b.advert?.format === "supplier_logo").length;
  const advertisers = new Set(live.map((b) => b.advert?.member_id).filter(Boolean)).size;
  const slotsSold = featuredSold.count ?? 0;

  const asRevenue = (rows: typeof paidInvoices) =>
    rows.map((i) => ({ number: i.number, amountPennies: i.amount_pennies, placementKind: i.placement?.kind ?? null }));
  const revenue = revenueByStream({
    activeMembers: payingMembers.count ?? 0,
    paidThisMonth: asRevenue(paidInvoices),
    unpaid: asRevenue(unpaidInvoices),
  });
  const maxStream = Math.max(revenue.membership, revenue.advertising, revenue.featured);
  const comped = Math.max(0, (members.count ?? 0) - (payingMembers.count ?? 0));

  // Rendered as "—" until the site_sessions migration is applied.
  const sessionCount = Number(sessions.data);
  const siteUsers = sessions.error || sessions.data == null || !Number.isFinite(sessionCount) ? null : sessionCount;

  const issueSent = lastSent?.[0];
  const dateLabel = new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

  const fmtTime = (t: string) => {
    const [h, m] = t.split(":");
    return new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const monthParam = monthKey(month);
  const overviewItems: OverviewItem[] = [
    ...(calStories ?? []).map((s) => ({
      id: s.id,
      type: "story" as const,
      title: s.title,
      date: new Date((s.status === "published" ? s.published_at : s.scheduled_at)!),
      href: `/console/stories/${s.id}?from=calendar&month=${monthParam}`,
    })),
    ...(calVideos ?? []).map((v) => ({
      id: v.id,
      type: "video" as const,
      title: v.title,
      date: new Date((v.status === "published" ? v.published_at : v.scheduled_at)!),
      href: `/console/videos/${v.id}?from=calendar&month=${monthParam}`,
    })),
    ...(calIssues ?? []).map((i) => ({
      id: i.id,
      type: "newsletter" as const,
      title: `#${i.number} — ${i.subject}`,
      date: new Date((i.status === "sent" ? i.sent_at : i.scheduled_at)!),
      href: "/console/newsletter?view=board",
    })),
    ...(calEvents ?? []).map((e) => ({
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
    { label: "Ready to review", value: pendingStories?.length ?? 0 },
    { label: "Drafts", value: draftStories.count ?? 0 },
    { label: "Scheduled", value: scheduledStories.count ?? 0 },
    { label: "Live", value: publishedStories.count ?? 0 },
  ];

  const videoPipeline: { label: string; value: number }[] = [
    { label: "Ready to review", value: pendingVideos?.length ?? 0 },
    { label: "Drafts", value: draftVideos.count ?? 0 },
    { label: "Scheduled", value: scheduledVideos.count ?? 0 },
    { label: "Live", value: publishedVideosCount.count ?? 0 },
  ];

  const needs: { label: string; href: string; urgent?: boolean }[] = [];
  // Issue #43: a Live item whose post time has passed with a channel still
  // unconfirmed waits indefinitely — listed once, linking to its editor.
  const socialWaits = await socialWaiting(db, { delayMinutes: (await readSocialCaps(db)).delay_minutes, now: new Date(now) });
  for (const w of socialWaits) {
    needs.push({ label: `Social post for “${w.title}”: ${waitingSummary(w.waiting, w.total)}`, href: w.href });
  }
  if (pendingStories?.length) needs.push({ label: `${pendingStories.length} member stories awaiting your approval`, href: "/console/stories" });
  if (pendingVideos?.length) needs.push({ label: `${pendingVideos.length} member videos awaiting your approval`, href: "/console/videos" });
  if (pendingEvents?.length) needs.push({ label: `${pendingEvents.length} member events awaiting approval`, href: "/console/events" });
  if (pendingAdverts?.length) needs.push({ label: `${pendingAdverts.length} member adverts awaiting approval`, href: "/console/adverts" });
  if (pendingArtworkSwaps?.length) needs.push({ label: `${pendingArtworkSwaps.length} artwork swap${pendingArtworkSwaps.length === 1 ? "" : "s"} awaiting approval`, href: "/console/adverts" });
  if (pendingRevisions?.length) needs.push({ label: `${pendingRevisions.length} member page edits awaiting approval`, href: "#approvals" });
  if (expiring?.length) needs.push({ label: `${expiring.length} adverts expire within 7 days`, href: "/console/adverts" });
  if (graceMembers?.length) needs.push({ label: `${graceMembers.length} memberships lapsing (grace period)`, href: "/console/members" });
  const readyToReview = (draftMembers ?? []).filter((m) => m.draft_submitted_at);
  const midFunnel = (draftMembers ?? []).length - readyToReview.length;
  if (readyToReview.length) needs.push({ label: `${readyToReview.length} new member page${readyToReview.length === 1 ? "" : "s"} ready to review & activate`, href: "/console/members" });
  if (midFunnel) needs.push({ label: `${midFunnel} signup${midFunnel === 1 ? "" : "s"} part-way through joining (watch the inbox)`, href: "/console/members" });
  if (draftIssue?.length) needs.push({ label: `Newsletter issue ${draftIssue[0].number} is drafted but unsent`, href: "/console/newsletter" });
  // A send that failed halfway to the whole list is the most urgent thing on
  // this page — it used to be invisible, because the issue was marked sent
  // regardless of what the sender did (GAPS C3).
  for (const issue of failedIssues ?? []) {
    needs.push({ label: `⚠ Newsletter issue ${issue.number} failed to send${issue.send_error ? ` — ${issue.send_error}` : ""}`, href: "/console/newsletter", urgent: true });
  }
  if (deadJobs?.length) needs.push({ label: `⚠ ${deadJobs.length} background jobs failed and need attention`, href: "#jobs", urgent: true });
  // A job that's never picked up never fails, so it never dead-letters into the
  // check above — this is the only signal that catches cron not running at all
  // (e.g. CRON_SECRET unset), which the deadJobs check can't see.
  const oldestDueAt = oldestOpenJob?.[0]?.due_at;
  const STALE_JOB_MS = 15 * 60 * 1000;
  if (oldestDueAt && now - Date.parse(oldestDueAt) > STALE_JOB_MS) {
    const staleMinutes = Math.round((now - Date.parse(oldestDueAt)) / 60_000);
    needs.push({ label: `⚠ Background jobs haven't run in over ${staleMinutes} minutes — check CRON_SECRET / cron config`, href: "#jobs", urgent: true });
  }

  return (
    // col-reverse puts the sidebar's urgent items first on small screens.
    <div className="mx-auto flex max-w-6xl flex-col-reverse gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-ink">Command Centre</h1>
        <p className="mt-1 text-sm text-graphite">{dateLabel}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active members" value={String(members.count ?? 0)} sub={`${pounds(MEMBERSHIP_MONTHLY_PENNIES)}/mo each`} />
          <Stat label="Live advertisers" value={String(advertisers)} sub={`${liveBanners} banners · ${liveLogos} supplier logos`} />
          <Stat label="Newsletter subscribers" value={String(subscribers.count ?? 0)} sub={issueSent ? `issue ${issueSent.number} sent ${String(issueSent.sent_at).slice(0, 10)}` : "clean list"} />
          <Stat label="Site users (12 mo)" value={siteUsers === null ? "—" : siteUsers.toLocaleString("en-GB")} sub="distinct sessions, rolling year" />
        </div>

        <Card className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle>Revenue this month</SectionTitle>
            <p className="text-xs text-graphite">
              memberships at {pounds(MEMBERSHIP_MONTHLY_PENNIES)}/mo · advertising as paid this month
              {revenue.outstanding > 0 && ` · ${pounds(revenue.outstanding)} invoiced, awaiting payment`}
            </p>
          </div>
          <p className="mt-3 text-4xl font-bold text-ink">
            {pounds(revenue.total)}
            <span className="text-base font-normal text-graphite"> / month</span>
          </p>
          <div className="mt-5 space-y-4">
            <RevenueBar label="Memberships" pennies={revenue.membership} max={maxStream} sub={`${payingMembers.count ?? 0} paying members × ${pounds(MEMBERSHIP_MONTHLY_PENNIES)}/mo${comped > 0 ? ` · ${comped} comped, not counted` : ""}`} />
            <RevenueBar label="Advertising" pennies={revenue.advertising} max={maxStream} sub={`paid this month · ${live.length} live bookings`} />
            <RevenueBar label="Featured member slots" pennies={revenue.featured} max={maxStream} sub={`paid this month · ${slotsSold} slot${slotsSold === 1 ? "" : "s"} sold`} />
          </div>
          <div className="mt-5 border-t border-black/5 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-ink">Featured slot occupancy</span>
              <span className="text-xs text-graphite">{slotsSold} of {FEATURED_SLOTS.cap} sold · {pounds(FEATURED_SLOTS.pennies)}/slot</span>
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
            {/* Placeholder columns signal via "—" + the badge, not opacity —
                dimming the 12px label drops it below WCAG AA contrast. */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {pipeline.map((p) => (
                <div key={p.label}>
                  <p className="text-xs uppercase tracking-wide text-graphite">{p.label}</p>
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
                  <p className="text-xs uppercase tracking-wide text-graphite">{p.label}</p>
                  <p className="mt-0.5 text-xl font-bold text-ink">{p.value}</p>
                </div>
              ))}
            </div>
          </Card>
        </Link>

        {/* Rendered unconditionally now. It used to be gated on
            `inbox?.length`, so an empty inbox meant the card vanished and
            nothing on this page said where messages go — which is exactly the
            state the card is most reassuring in. */}
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <SectionTitle>Messages</SectionTitle>
            <Link href="/console/notifications?category=message" className="text-xs text-graphite underline">View all →</Link>
          </div>
          {inbox?.length ? (
            inbox.map((m) => (
              <div key={m.id} className="relative mt-2 rounded border p-3 text-sm transition hover:bg-shade/50">
                <div className="flex items-center justify-between">
                  <p><b>{m.name}</b> <span className="text-graphite">&lt;{m.email}&gt;</span> · <span className="text-xs uppercase text-brand-text">{inboxKindLabel(m.kind)}</span></p>
                  {/* z-10 keeps the button clickable above the row's stretched link */}
                  <form action={markInboxRead} className="z-10"><input type="hidden" name="id" value={m.id} /><button className="relative text-xs text-graphite hover:text-ink">mark read</button></form>
                </div>
                {/* The whole row opens the message — full text and reply live there. */}
                <Link href={`/console/notifications/${m.id}`} className="mt-1 block text-graphite after:absolute after:inset-0">
                  <span className="line-clamp-2">{m.message}</span>
                  <span className="sr-only"> — open message from {m.name}</span>
                </Link>
              </div>
            ))
          ) : (
            <p className="mt-2 text-sm text-graphite">Nobody is waiting on a reply. 📭</p>
          )}
          {/* Without this line the notifications half would be reachable only
              from the header bell, which is not obvious from here. */}
          <p className="mt-3 border-t border-black/5 pt-3 text-xs text-graphite">
            Signups, payments and member submissions are notifications, not messages —{" "}
            <Link href="/console/notifications?category=notification" className="underline hover:text-ink">see the notifications feed →</Link>
          </p>
        </Card>

        {deadJobs?.length ? (
          <section id="jobs" className="mt-6 rounded-xl border-2 border-danger/30 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-danger">Failed background jobs</h2>
            {deadJobs.map((j) => (
              <p key={j.id} className="mt-1 text-sm text-graphite"><b>{j.kind}</b>: {j.last_error}</p>
            ))}
          </section>
        ) : null}
      </div>

      <aside className="shrink-0 lg:w-80">
        <Card>
          <SectionTitle>Needs you today</SectionTitle>
          {needs.length === 0 && <p className="mt-2 text-sm text-graphite">Nothing urgent. Enjoy the moon. 🌕</p>}
          <ul className="mt-2 space-y-1.5">
            {needs.map((n) => (
              <li key={n.label}>
                <Link href={n.href} className={`text-sm hover:underline ${n.urgent ? "font-semibold text-danger" : "text-graphite"}`}>→ {n.label}</Link>
              </li>
            ))}
          </ul>
        </Card>

        {pendingRevisions?.length ? (
          <Card id="approvals" className="mt-6">
            <SectionTitle>Page edits to review</SectionTitle>
            {pendingRevisions?.map((r) => (
              <div key={r.id} className="mt-2 flex items-center justify-between gap-3 rounded border p-3 text-sm">
                <span>Page edit from <b>{r.member?.name}</b></span>
                {/* Not approved from here: Approve publishes the member's own
                    edit, so it's decided on their page, where the field-by-field
                    changes are shown (and a Reject carries a reason). */}
                <Link href={`/console/members/${r.member_id}#changes`} className="rounded bg-ink px-3 py-1 text-white">Review changes</Link>
              </div>
            ))}
          </Card>
        ) : null}
      </aside>
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
      <p className="mt-0.5 text-xs text-graphite">{sub}</p>
    </div>
  );
}
