import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { notificationLabel } from "@/lib/email/templates";
import { OnboardingChecklist } from "./OnboardingChecklist";

export const dynamic = "force-dynamic";

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

  const [{ data: lastStory }, { data: pending }, { data: notifications }, { data: member }, { data: pendingAdverts }] = await Promise.all([
    db.from("stories").select("published_at").eq("member_id", user.memberId).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("stories").select("id, title, status, rejected_reason").eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("notifications").select("kind, payload, created_at").eq("member_id", user.memberId).order("created_at", { ascending: false }).limit(4),
    db.from("members").select("status, paid_at, comped_until, draft_submitted_at").eq("id", user.memberId).single(),
    // Adverts belong to the member, and their run carries the state — so this
    // asks the bookings table, filtered through the member's own artwork.
    db.from("advert_bookings")
      .select("id, status, review_reason, starts_on, advert:adverts!inner(name, member_id)")
      .eq("advert.member_id", user.memberId)
      .in("status", ["draft", "awaiting_approval", "review_required"])
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  // nudge: "the last time you posted a story was six months ago"
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthsSince = lastStory?.published_at
    ? Math.floor((now - new Date(lastStory.published_at).getTime()) / (30 * 864e5))
    : null;
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

      <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
      {monthsSince !== null && monthsSince >= 3 && (
        <p className="mt-2 rounded-lg border-2 border-brand bg-brand/10 p-3 text-sm">
          The last time you posted a story was <b>{monthsSince} months ago</b> — your page works harder when it&apos;s fresh.{" "}
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

      {((pending ?? []).length > 0 || (pendingAdverts ?? []).length > 0) && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Your submissions</h2>
          {(pending ?? []).map((s) => (
            <p key={s.id} className="mt-2 border-t pt-2 text-sm">
              {s.title} —{" "}
              {s.status === "awaiting_approval"
                ? <span className="text-brand">awaiting approval</span>
                : <span className="text-red-600">not published{s.rejected_reason && `: ${s.rejected_reason}`}</span>}
            </p>
          ))}
          {/* Adverts are actionable in a way stories are not — a sent-back run
              can be edited and resubmitted, so each one links to its own page. */}
          {(pendingAdverts ?? []).map((b) => (
            <p key={b.id} className="mt-2 border-t pt-2 text-sm">
              <Link href={`/dashboard/advert/${b.id}`} className="hover:underline">{b.advert?.name}</Link> —{" "}
              {b.status === "awaiting_approval"
                ? <span className="text-brand">awaiting approval</span>
                : b.status === "draft"
                ? <span className="text-gray-500">draft, not sent</span>
                : <span className="text-red-600">needs a change{b.review_reason && `: ${b.review_reason}`}</span>}
            </p>
          ))}
        </section>
      )}

      {(notifications ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Recent updates</h2>
          {(notifications ?? []).map((n, i) => (
            <p key={i} className="mt-2 border-t pt-2 text-sm text-gray-600">
              {n.created_at.slice(0, 10)} — {n.kind === "story_live" ? "Your story went live 🎉" : notificationLabel(n.kind)}
            </p>
          ))}
        </section>
      )}

      <p className="mt-6 text-center text-xs text-gray-400">
        <Link href="/dashboard/resources" className="underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/dashboard/settings" className="underline">Notification settings</Link>
      </p>
    </div>
  );
}
