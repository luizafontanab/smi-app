import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { SkipLink } from "@/components/SkipLink";
import { accountLinks } from "@/components/SiteHeader";
import { Wordmark } from "@/components/Wordmark";
import { ConsoleNav, type NavSection } from "@/components/console/ConsoleNav";
import { signOut } from "@/app/actions";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { unreadNotificationCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Flat — seven top-level pages don't need the console's two-tier treatment.
// The advertising hub carries its own Information/Buy/Manage strip.
const NAV: NavSection[] = [
  { key: "overview", href: "/dashboard", label: "Dashboard" },
  { key: "profile", href: "/dashboard/profile", label: "My page" },
  { key: "content", href: "/dashboard/story/new", label: "Add content" },
  // Was reachable only via the dashboard box's "See all" link (fix list).
  { key: "submissions", href: "/dashboard/submissions", label: "Your content" },
  { key: "advertising", href: "/dashboard/advertising", label: "Advertising" },
  { key: "stats", href: "/dashboard/stats", label: "Stats" },
  { key: "help", href: "/dashboard/help", label: "Help" },
  { key: "settings", href: "/dashboard/settings", label: "Settings" },
];

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();
  const [{ data: member }, unread] = await Promise.all([
    serviceDb().from("members").select("name, status").eq("id", user.memberId).single(),
    unreadNotificationCount(user.memberId),
  ]);

  return (
    <div className="min-h-screen bg-paper">
      <SkipLink />
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
            <AccountMenu name={member?.name ?? user.email} links={accountLinks(user, unread)} signOutAction={signOut} unread={unread} />
          </div>
        </div>
        <div className="mx-auto max-w-5xl">
          <ConsoleNav root="/dashboard" items={NAV} />
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
