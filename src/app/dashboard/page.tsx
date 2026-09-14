import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { notificationLabel } from "@/lib/email/templates";
import { pendingSubmissions } from "@/lib/submissions";
import { dismissOnboarding } from "./actions";
import { SubmissionList } from "@/components/dashboard/SubmissionList";
import { IconBuilding, IconChart, IconHelp, IconMegaphone, IconNewspaper, IconSettings } from "@/components/icons";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { WelcomePanel } from "./WelcomePanel";

export const dynamic = "force-dynamic";

// Equipment self-submission is hidden for now (fix list item 9) — the routes,
// actions and the submissions list below stay live so in-flight machines can
// still be edited or withdrawn.
// Order and set fixed by the fix list: content, advertising, stats, page,
// help, settings — "Add content" skips the icon-grid hub and goes straight to
// the tabbed Story form (fix list item 6); Billing is now a Settings tab.
const CARDS = [
  { href: "/dashboard/story/new", Icon: IconNewspaper, title: "Add content", sub: "Stories, videos, events" },
  { href: "/dashboard/advertising", Icon: IconMegaphone, title: "Advertising", sub: "Adverts, featured slots & newsletter" },
  { href: "/dashboard/stats", Icon: IconChart, title: "Statistics", sub: "Who's engaging with you" },
  { href: "/dashboard/profile", Icon: IconBuilding, title: "Your page", sub: "Description, images, video, socials" },
  { href: "/dashboard/help", Icon: IconHelp, title: "Help", sub: "Guides and support" },
  { href: "/dashboard/settings", Icon: IconSettings, title: "Settings", sub: "Notifications, security & billing" },
];

export default async function MemberDashboard(props: PageProps<"/dashboard">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();

  // A4.17 — one pre-approval submission list across all four content types
  // (lib/submissions). Like "Recent updates", the box shows the newest few and
  // the badge carries the true total; "See all" opens /dashboard/submissions.
  const [
    { data: lastStory }, pending,
    { data: notifications }, { data: member },
  ] = await Promise.all([
    db.from("stories").select("published_at").eq("member_id", user.memberId).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    pendingSubmissions(user.memberId, { limit: 4 }),
    db.from("notifications").select("kind, payload, created_at").eq("member_id", user.memberId).order("created_at", { ascending: false }).limit(4),
    db.from("members").select("status, paid_at, comped_until, draft_submitted_at, onboarding_seen").eq("id", user.memberId).single(),
  ]);

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

      {/* Both boxes render unconditionally. They used to be gated on a non-empty
          array, so a member with nothing in flight saw the dashboard simply end
          after the card grid — no indication the feature existed at all, and no
          way through to /dashboard/content or /dashboard/notifications. An empty
          state is the more honest shape. */}
      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Your submissions</h2>
          <Link href="/dashboard/submissions" className="text-sm text-graphite underline">See all →</Link>
        </div>
        {pending.items.length > 0
          ? <SubmissionList items={pending.items} />
          : <p className="mt-2 text-sm text-graphite">Nothing awaiting approval — anything you send in shows up here.</p>}
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Recent updates</h2>
          <Link href="/dashboard/notifications" className="text-sm text-graphite underline">See all →</Link>
        </div>
        {(notifications ?? []).length > 0
          ? (notifications ?? []).map((n, i) => (
              <p key={i} className="mt-2 border-t pt-2 text-sm text-graphite">
                {n.created_at.slice(0, 10)} — {n.kind === "story_live" ? "Your story went live 🎉" : notificationLabel(n.kind)}
              </p>
            ))
          : <p className="mt-2 text-sm text-graphite">No updates yet. We&apos;ll let you know when something changes.</p>}
      </section>

      <p className="mt-6 text-center text-xs text-graphite">
        <Link href="/dashboard/resources" className="underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/dashboard/settings" className="underline">Notification settings</Link>
      </p>
    </div>
  );
}
