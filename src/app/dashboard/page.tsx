import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { notificationLabel } from "@/lib/email/templates";
import { dismissOnboarding, withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo } from "./actions";
import { IconBuilding, IconChart, IconMegaphone, IconNewspaper, IconReceipt } from "@/components/icons";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { WelcomePanel } from "./WelcomePanel";

export const dynamic = "force-dynamic";

// Equipment self-submission is hidden for now (fix list item 9) — the routes,
// actions and the submissions list below stay live so in-flight machines can
// still be edited or withdrawn.
const CARDS = [
  { href: "/dashboard/profile", Icon: IconBuilding, title: "Update your page", sub: "Description, images, video, socials" },
  { href: "/dashboard/content", Icon: IconNewspaper, title: "Add content", sub: "Stories, videos, events" },
  { href: "/dashboard/advertising", Icon: IconMegaphone, title: "Advertising", sub: "Adverts, featured slots & newsletter" },
  { href: "/dashboard/stats", Icon: IconChart, title: "View statistics", sub: "Who's engaging with you" },
  { href: "/dashboard/settings/billing", Icon: IconReceipt, title: "Billing", sub: "Invoices & membership" },
];

export default async function MemberDashboard(props: PageProps<"/dashboard">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();

  const pendingCols = "id, title, status, rejected_reason";
  const [
    { data: lastStory }, { data: pendingStories }, { data: pendingVideos }, { data: pendingEvents }, { data: pendingMachines },
    { data: notifications }, { count: unreadNotifications }, { data: member },
  ] = await Promise.all([
    db.from("stories").select("published_at").eq("member_id", user.memberId).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("stories").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("videos").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("events").select(pendingCols).eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("featured_machines").select("id, name, status, rejected_reason").eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("notifications").select("kind, payload, created_at").eq("member_id", user.memberId).order("created_at", { ascending: false }).limit(4),
    db.from("notifications").select("*", { count: "exact", head: true }).eq("member_id", user.memberId).is("read_at", null),
    db.from("members").select("status, paid_at, comped_until, draft_submitted_at, onboarding_seen").eq("id", user.memberId).single(),
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
  const monthsSince = lastStory?.published_at
    ? Math.floor((now - new Date(lastStory.published_at).getTime()) / (30 * 864e5))
    : null;
  const neverPosted = !lastStory;
  const submitted = typeof sp.submitted === "string" ? sp.submitted : null;

  return (
    <div>
      {submitted && (
        <p className="mb-4 rounded-lg bg-success/10 p-3 text-sm text-success">
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
            <c.Icon className="mx-auto text-graphite" />
            <p className="mt-2 font-bold text-ink">{c.title}</p>
            <p className="mt-1 text-xs text-graphite">{c.sub}</p>
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
                  ? <span className="text-brand-text">awaiting approval</span>
                  : <span className="text-danger">not published{s.rejected_reason && `: ${s.rejected_reason}`}</span>}
              </p>
              <div className="flex items-center gap-3 text-xs">
                <Link href={s.editHref} className="tap px-1 text-graphite underline">Edit</Link>
                <form action={s.withdrawAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="tap px-1 text-graphite underline hover:text-danger">Withdraw</button>
                </form>
              </div>
            </div>
          ))}
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
            <p key={i} className="mt-2 border-t pt-2 text-sm text-graphite">
              {n.created_at.slice(0, 10)} — {n.kind === "story_live" ? "Your story went live 🎉" : notificationLabel(n.kind)}
            </p>
          ))}
        </section>
      )}

      <p className="mt-6 text-center text-xs text-graphite">
        <Link href="/dashboard/resources" className="underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/dashboard/settings" className="underline">Notification settings</Link>
      </p>
    </div>
  );
}
