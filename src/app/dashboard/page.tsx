import Link from "next/link";
import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { loadEmailTemplates } from "@/lib/email/store";
import { notificationLabel, type NotificationPayload } from "@/lib/email/templates";
import { notificationHref } from "@/lib/notification-links";
import { notificationSlugs } from "@/lib/notifications";
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

/** The shortcut card grid; `only` hides it at the breakpoint where the other copy shows. */
function shortcuts(only: "sm:hidden" | "max-sm:hidden") {
  return (
    <div data-testid="dashboard-shortcuts" className={`${only} mt-6 grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3`}>
      {CARDS.map((c) => (
        <Link key={c.href} href={c.href} className="flex items-center gap-2 rounded-xl bg-white p-3 shadow-sm transition hover:shadow-md sm:block sm:p-5 sm:text-center">
          <c.Icon className="h-5 w-5 shrink-0 text-graphite sm:mx-auto sm:h-7 sm:w-7" />
          <span className="block min-w-0">
            <span className="block text-sm font-bold text-ink sm:mt-2 sm:text-base">{c.title}</span>
            <span className="mt-1 hidden text-xs text-graphite sm:block">{c.sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export default async function MemberDashboard(props: PageProps<"/dashboard">) {
  const user = await requireMemberView();
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
    db.from("members").select("slug, status, paid_at, comped_until, draft_submitted_at, onboarding_seen").eq("id", user.memberId).single(),
  ]);

  const slugs = await notificationSlugs(notifications ?? [], user.memberId);
  // Labels are console-editable, so the feed reads them from the same table the
  // emails do (GAPS A4.10) rather than from a copy in the page.
  const templates = await loadEmailTemplates();

  // nudge: "the last time you posted a story was six months ago"
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthsSince = lastStory?.published_at
    ? Math.floor((now - new Date(lastStory.published_at).getTime()) / (30 * 864e5))
    : null;
  const neverPosted = !lastStory;
  // Matches the console's own rule for "is there a public page to look at".
  const isPublic = member?.status === "active" || member?.status === "grace";
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

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
        {/* A member had no way to reach their own live page from here (fix
            list). Only shown once there is one: a draft or lapsed page is not
            public, and linking to it would 404 or show a stranger's view. */}
        {isPublic && member?.slug && (
          <Link href={`/member/${member.slug}`} className="text-sm text-graphite underline">
            View your public page →
          </Link>
        )}
      </div>
      {member?.status !== "draft" && (neverPosted || (monthsSince !== null && monthsSince >= 3)) && (
        <p className="mt-2 rounded-lg border-2 border-brand bg-brand/10 p-3 text-sm">
          {neverPosted
            ? "You haven't posted a story yet"
            : <>The last time you posted a story was <b>{monthsSince} months ago</b></>} — your page works harder when it&apos;s fresh.{" "}
          <Link href="/dashboard/story/new" className="font-semibold text-graphite underline">Add one now →</Link>
        </p>
      )}


      {/* Both boxes render unconditionally. They used to be gated on a non-empty
          array, so a member with nothing in flight saw the dashboard simply end
          after the card grid — no indication the feature existed at all, and no
          way through to /dashboard/content or /dashboard/notifications. An empty
          state is the more honest shape. */}
      {/* On phones the member's own status comes first and the shortcut cards
          (which repeat the nav) shrink to a compact grid at the end — they used
          to push "Your submissions" ~1,000px down (#33 M10). Two copies, one
          per breakpoint, each in its place in the source — not one copy moved
          with CSS `order`, which left keyboard and screen-reader order out of
          step with the screen. The off-breakpoint copy is display:none, so it
          is out of the tab order and the accessibility tree. */}
      {shortcuts("max-sm:hidden")}

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Your submissions</h2>
          <Link href="/dashboard/submissions" className="tap text-sm text-graphite underline">See all →</Link>
        </div>
        {pending.items.length > 0
          ? <SubmissionList items={pending.items} />
          : <p className="mt-2 text-sm text-graphite">Nothing awaiting approval — anything you send in shows up here.</p>}
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Recent updates</h2>
          <Link href="/dashboard/notifications" className="tap text-sm text-graphite underline">See all →</Link>
        </div>
        {(notifications ?? []).length > 0
          ? (notifications ?? []).map((n, i) => {
              const label = notificationLabel(n.kind, templates);
              const href = notificationHref(n.kind, (n.payload ?? {}) as NotificationPayload, slugs);
              return (
                <p key={i} className="mt-2 border-t pt-2 text-sm text-graphite">
                  {n.created_at.slice(0, 10)} —{" "}
                  {href ? <Link href={href} className="underline hover:text-ink">{label}</Link> : label}
                </p>
              );
            })
          : <p className="mt-2 text-sm text-graphite">No updates yet. We&apos;ll let you know when something changes.</p>}
      </section>

      {shortcuts("sm:hidden")}

      <p className="mt-6 text-center text-sm text-graphite sm:text-xs">
        <Link href="/dashboard/resources" className="tap underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/dashboard/settings" className="tap underline">Notification settings</Link>
      </p>
    </div>
  );
}
