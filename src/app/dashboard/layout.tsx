import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { SkipLink } from "@/components/SkipLink";
import { memberAccountLinks } from "@/components/SiteHeader";
import { Wordmark } from "@/components/Wordmark";
import { ConsoleNav, type NavSection } from "@/components/console/ConsoleNav";
import { ViewAsBanner } from "@/components/dashboard/ViewAsBanner";
import { signOut } from "@/app/actions";
import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { unreadNotificationCount } from "@/lib/notifications";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

// Flat — these top-level pages don't need the console's two-tier treatment.
// The advertising hub carries its own Information/Buy/Manage strip.
// `match`: pages that belong to a tab without being its link, so every page
// lights one (#33 M20) — the Video, Event and Equipment forms are "Add
// content"; an item's edit page is "Your content"; an advert's own page is
// "Advertising"; paying an invoice is Settings → Billing; notifications
// (reached from the dashboard's "See all") are Dashboard; resources are Help.
// An equipment edit page is "Your content" even though Advertising → Assets
// also links to it: machines are listed in Your content too (lib/submissions
// EDIT_HREF), and the layout can't see which list the member came from, so
// it follows the same rule as every other item's edit page.
const NAV: NavSection[] = [
  { key: "overview", href: "/dashboard", label: "Dashboard", match: ["/dashboard/notifications"] },
  { key: "profile", href: "/dashboard/profile", label: "My page" },
  { key: "content", href: "/dashboard/story/new", label: "Add content", match: ["/dashboard/video/new", "/dashboard/event/new", "/dashboard/equipment/new"] },
  // Was reachable only via the dashboard box's "See all" link (fix list).
  { key: "submissions", href: "/dashboard/submissions", label: "Your content", match: ["/dashboard/story", "/dashboard/video", "/dashboard/event", "/dashboard/equipment"] },
  { key: "advertising", href: "/dashboard/advertising", label: "Advertising", match: ["/dashboard/advert"] },
  { key: "stats", href: "/dashboard/stats", label: "Stats" },
  { key: "leads", href: "/dashboard/leads", label: "Leads" },
  { key: "help", href: "/dashboard/help", label: "Help", match: ["/dashboard/resources"] },
  { key: "settings", href: "/dashboard/settings", label: "Settings", match: ["/dashboard/billing", "/dashboard/pay"] },
];

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMemberView();
  const [{ data: member }, unread, leadsOn] = await Promise.all([
    serviceDb().from("members").select("name, status").eq("id", user.memberId).single(),
    unreadNotificationCount(user.memberId),
    isFeatureEnabled("member_leads"),
  ]);
  // Feature flag (/console/features): Leads drops out of the nav while it's off.
  const nav = leadsOn ? NAV : NAV.filter((section) => section.key !== "leads");

  return (
    <div className="min-h-screen bg-paper">
      <SkipLink />
      {user.viewingAs && <ViewAsBanner memberName={member?.name ?? "this member"} />}
      {/* Light, like the public header, and one row above the tabs (#33 H14,
          M18): it was 138px of near-black chrome over three rows on a phone.
          The company name shows from sm up; on a phone the account menu
          carries it (its accessible name and first line). */}
      <header className="border-b border-line bg-white text-ink">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:py-3">
          {/* The main wordmark now exits to the public homepage — same
              behaviour as the console lockup; the nav's Dashboard entry
              covers the member home. */}
          <Link href="/" className="shrink-0"><Wordmark tone="light" /></Link>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            {/* data-testid: the e2e suite reads the company name here — styling
                classes on this span change too often to anchor a locator on. */}
            <span data-testid="member-name" className="hidden max-w-[14rem] truncate text-graphite sm:block">{member?.name}</span>
            <AccountMenu name={member?.name ?? user.email} links={memberAccountLinks(unread)} signOutAction={signOut} unread={unread} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl">
          <ConsoleNav root="/dashboard" items={nav} tone="light" />
        </div>
        {member?.status === "grace" && (
          <div className="bg-brand py-1.5 text-center text-sm font-medium text-ink">
            Your membership payment is overdue — your page stays live during the grace period. Please update payment or contact us.
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
