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
const NAV: NavSection[] = [
  { key: "overview", href: "/dashboard", label: "Dashboard" },
  { key: "profile", href: "/dashboard/profile", label: "My page" },
  { key: "content", href: "/dashboard/story/new", label: "Add content" },
  // Was reachable only via the dashboard box's "See all" link (fix list).
  { key: "submissions", href: "/dashboard/submissions", label: "Your content" },
  { key: "advertising", href: "/dashboard/advertising", label: "Advertising" },
  { key: "stats", href: "/dashboard/stats", label: "Stats" },
  { key: "leads", href: "/dashboard/leads", label: "Leads" },
  { key: "help", href: "/dashboard/help", label: "Help" },
  { key: "settings", href: "/dashboard/settings", label: "Settings" },
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
      <header className="bg-chrome text-white">
        {/* flex-wrap + truncate: a long company name must never force the page
            into horizontal scroll at phone widths. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-1 px-4 py-3">
          {/* The main wordmark now exits to the public homepage — same
              behaviour as the console lockup; the nav's Dashboard entry
              covers the member home. */}
          <Link href="/"><Wordmark /></Link>
          <div className="flex items-center gap-3 text-sm">
            {/* data-testid: the e2e suite reads the company name here — styling
                classes on this span change too often to anchor a locator on. */}
            <span data-testid="member-name" className="max-w-[14rem] truncate text-white/75">{member?.name}</span>
            <AccountMenu name={member?.name ?? user.email} links={memberAccountLinks(unread)} signOutAction={signOut} unread={unread} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl">
          <ConsoleNav root="/dashboard" items={nav} />
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
