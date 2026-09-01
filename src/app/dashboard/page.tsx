import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { bookingPhase } from "@/lib/adverts";
import { serviceDb } from "@/lib/db/server";
import { notificationLabel } from "@/lib/email/templates";
import { dismissOnboarding, withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo } from "./actions";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { WelcomePanel } from "./WelcomePanel";

export const dynamic = "force-dynamic";

const ADVERT_PHASE: Record<string, { label: string; className: string }> = {
  draft: { label: "draft, not sent", className: "text-gray-500" },
  awaiting: { label: "awaiting approval", className: "text-brand" },
  changes_needed: { label: "needs a change", className: "text-red-600" },
  upcoming: { label: "scheduled", className: "text-graphite" },
  live: { label: "live now", className: "text-green-600" },
  ended: { label: "ended — run it again?", className: "text-gray-500" },
};

const CARDS = [
  { href: "/dashboard/profile", icon: "🏢", title: "Update your page", sub: "Description, images, video, socials" },
  { href: "/dashboard/story/new", icon: "📰", title: "Add a story", sub: "Your news on SMI's channels" },
  { href: "/dashboard/video/new", icon: "🎬", title: "Add a video", sub: "Your video on SMI's channels" },
  { href: "/dashboard/event/new", icon: "📅", title: "Add an event", sub: "Open days, shows, launches" },
  { href: "/dashboard/equipment/new", icon: "⚙️", title: "Add equipment", sub: "Machines for sale, linked to your site" },
  { href: "/dashboard/stats", icon: "📈", title: "View statistics", sub: "Who's engaging with you" },
  { href: "/dashboard/advert/new", icon: "📣", title: "Advertise", sub: "Your banner in the rotation" },
  { href: "/dashboard/buy", icon: "⭐", title: "Buy visibility", sub: "Featured slots & newsletter" },
  { href: "/dashboard/billing", icon: "🧾", title: "Billing", sub: "Invoices & membership" },
];

export default async function MemberDashboard(props: PageProps<"/dashboard">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();

  const pendingCols = "id, title, status, rejected_reason";
  const [
    { data: lastStory }, { data: pendingStories }, { data: pendingVideos }, { data: pendingEvents }, { data: pendingMachines },
    { data: notifications }, { count: unreadNotifications }, { data: member }, { data: advertBookings },
  ] = await Promise.all([
    db.from("stories").select("published_at").eq("member_id", user.memberId).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("stories").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("videos").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("events").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("featured_machines").select("id, name, status, rejected_reason").eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("notifications").select("kind, payload, created_at").eq("member_id", user.memberId).order("created_at", { ascending: false }).limit(4),
    db.from("notifications").select("*", { count: "exact", head: true }).eq("member_id", user.memberId).is("read_at", null),
    db.from("members").select("status, paid_at, comped_until, draft_submitted_at, onboarding_seen").eq("id", user.memberId).single(),
    // Adverts belong to the member, and their run carries the state — so this
    // asks the bookings table, filtered through the member's own artwork.
    // Unfiltered by status (A2.5): scheduled/live/ended runs need to reach
    // the member too, not just the pre-approval statuses.
    db.from("advert_bookings")
      .select("id, status, review_reason, starts_on, ends_on, advert:adverts!inner(name, member_id)")
      .eq("advert.member_id", user.memberId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // A4.17 — one pre-approval submission list across all four content types,
  // each with its own edit page and withdraw action.
  const pending = [
    ...(pendingStories ?? []).map((s) => ({ ...s, editHref: `/dashboard/story/${s.id}/edit` as const, withdrawAction: withdrawStory })),
    ...(pendingVideos ?? []).map((v) => ({ ...v, editHref: `/dashboard/video/${v.id}/edit` as const, withdrawAction: withdrawVideo })),
    ...(pendingEvents ?? []).map((e) => ({ ...e, editHref: `/dashboard/event/${e.id}/edit` as const, withdrawAction: withdrawEvent })),
    ...(pendingMachines ?? []).map((m) => ({
      id: m.id, title: m.name, status: m.status, rejected_reason: m.rejected_reason,
      editHref: `/dashboard/equipment/${m.id}/edit` as const, withdrawAction: withdrawMachine,
    })),
  ];

  // nudge: "the last time you posted a story was six months ago"
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const monthsSince = lastStory?.published_at
    ? Math.floor((now - new Date(lastStory.published_at).getTime()) / (30 * 864e5))
    : null;
  const neverPosted = !lastStory;
  const submitted = typeof sp.submitted === "string" ? sp.submitted : null;

  return (
    <div>
      {submitted && (
        <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {submitted === "paid" && "Payment sorted — now build your company page and submit it for approval."}
          {submitted === "page" && "Page submitted — Jas reviews it and you'll be live in the directory once approved."}
          {submitted === "story" && "Story submitted — it goes live once the editor approves it, and we'll email you."}
          {submitted === "video" && "Video submitted — it goes live once the editor approves it, and we'll email you."}
          {submitted === "event" && "Event submitted for approval."}
          {submitted === "machine" && "Equipment submitted — it appears once the editor approves it."}
          {submitted === "profile" && "Page changes submitted — they appear once approved."}
          {submitted === "buy" && "Request received — Jas will confirm and invoice you."}
          {submitted === "advert" && "Advert submitted — we'll confirm availability, invoice you, and email you when it's scheduled."}
        </p>
      )}

      {member?.status === "draft" && (
        <OnboardingChecklist
          paid={Boolean(member.paid_at || member.comped_until)}
          pageSubmitted={Boolean(member.draft_submitted_at)}
        />
      )}
      {member && member.status !== "draft" && !member.onboarding_seen && (
        <WelcomePanel dismissAction={dismissOnboarding} />
      )}

      <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
      {member?.status !== "draft" && (neverPosted || (monthsSince !== null && monthsSince >= 3)) && (
        <p className="mt-2 rounded-lg border-2 border-brand bg-brand/10 p-3 text-sm">
          {neverPosted
            ? "You haven't posted a story yet"
            : <>The last time you posted a story was <b>{monthsSince} months ago</b></>} — your page works harder when it&apos;s fresh.{" "}
          <Link href="/dashboard/story/new" className="font-semibold text-graphite underline">Add one now →</Link>
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl bg-white p-5 text-center shadow-sm transition hover:shadow-md">
            <span className="text-3xl">{c.icon}</span>
            <p className="mt-2 font-bold text-ink">{c.title}</p>
            <p className="mt-1 text-xs text-gray-500">{c.sub}</p>
          </Link>
        ))}
      </div>

      {pending.length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Your submissions</h2>
          {pending.map((s) => (
            <div key={s.editHref} className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-sm">
              <p>
                {s.title} —{" "}
                {s.status === "awaiting_approval"
                  ? <span className="text-brand">awaiting approval</span>
                  : <span className="text-red-600">not published{s.rejected_reason && `: ${s.rejected_reason}`}</span>}
              </p>
              <div className="flex items-center gap-3 text-xs">
                <Link href={s.editHref} className="text-graphite underline">Edit</Link>
                <form action={s.withdrawAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-gray-500 underline hover:text-red-600">Withdraw</button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      {(advertBookings ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Your adverts</h2>
          {/* Every phase links to its own page — /dashboard/advert/[id] already
              handles artwork-swap (upcoming/live) and "Run it again" (ended). */}
          {(advertBookings ?? []).map((b) => {
            const phase = bookingPhase(b, today);
            const p = ADVERT_PHASE[phase];
            return (
              <p key={b.id} className="mt-2 border-t pt-2 text-sm">
                <Link href={`/dashboard/advert/${b.id}`} className="hover:underline">{b.advert?.name}</Link> —{" "}
                <span className={p.className}>
                  {p.label}{phase === "changes_needed" && b.review_reason && `: ${b.review_reason}`}
                </span>
              </p>
            );
          })}
        </section>
      )}

      {(notifications ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-ink">
              Recent updates{Boolean(unreadNotifications) && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-ink">{unreadNotifications}</span>}
            </h2>
            <Link href="/dashboard/notifications" className="text-sm text-graphite underline">See all →</Link>
          </div>
          {(notifications ?? []).map((n, i) => (
            <p key={i} className="mt-2 border-t pt-2 text-sm text-gray-600">
              {n.created_at.slice(0, 10)} — {n.kind === "story_live" ? "Your story went live 🎉" : notificationLabel(n.kind)}
            </p>
          ))}
        </section>
      )}

      <p className="mt-6 text-center text-xs text-gray-500">
        <Link href="/dashboard/resources" className="underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/dashboard/settings" className="underline">Notification settings</Link>
      </p>
    </div>
  );
}
