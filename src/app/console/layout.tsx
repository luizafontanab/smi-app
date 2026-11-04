import Link from "next/link";
import { isDeveloper } from "@/lib/developer";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { THEME_SWITCHER_ENABLED } from "@/lib/theme-switcher-flag";
import { AccountMenu } from "@/components/AccountMenu";
import { ConsoleNav, type NavSection } from "@/components/console/ConsoleNav";
import { IconBell } from "@/components/icons";
import { accountLinks } from "@/components/SiteHeader";
import { signOut } from "@/app/actions";
import { isAdmin, requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { SkipLink } from "@/components/SkipLink";

export const dynamic = "force-dynamic";

// Two-tier nav: row 1 is these sections, row 2 (always rendered) shows
// whichever section's children match the current route. Leaf sections (no
// children) behave like a plain link and leave row 2 empty. The notifications
// feed left the nav for the header bell — see the link below.
const CONSOLE_SECTIONS: NavSection[] = [
  { key: "home", href: "/console", label: "Command Centre" },
  { key: "analytics", href: "/console/analytics", label: "Analytics" },
  {
    key: "cms",
    href: "/console/stories",
    label: "Content",
    children: [
      { href: "/console/stories", label: "Story Engine" },
      { href: "/console/sources", label: "Story Sources" },
      { href: "/console/videos", label: "Video Engine" },
      { href: "/console/events", label: "Events" },
      { href: "/console/newsletter", label: "Newsletter" },
    ],
  },
  {
    key: "adverts",
    href: "/console/adverts",
    label: "Adverts & Banners",
    children: [
      { href: "/console/adverts", label: "Bookings" },
      { href: "/console/adverts/artwork", label: "Artwork" },
      // Was "Inventory" (rate card + banner spots). The rate card went in
      // fix-list 77, leaving only banner spots, so: Banners (fix-list 79).
      { href: "/console/adverts/banners", label: "Banners" },
      { href: "/console/adverts/bundles", label: "Bundles" },
      { href: "/console/adverts/takeover", label: "Takeover" },
      { href: "/console/adverts/featured-member", label: "Featured Member" },
      { href: "/console/adverts/featured-event", label: "Featured Event" },
      { href: "/console/adverts/suppliers", label: "Supplier Logos" },
      { href: "/console/adverts/interest", label: "Interest" },
    ],
  },
  {
    key: "members",
    href: "/console/members",
    label: "Members & CRM",
    children: [
      { href: "/console/members", label: "Members" },
      { href: "/console/crm", label: "CRM" },
      { href: "/console/leads", label: "Lead Gen" },
      { href: "/console/promo-codes", label: "Promo Codes" },
    ],
  },
  {
    key: "config",
    href: "/console/machines",
    label: "Site Config",
    children: [
      { href: "/console/machines", label: "Featured Machine" },
      { href: "/console/content-pages", label: "Content Pages" },
      // The media pack and the public A–F format cards. Website content, not
      // inventory — which is why they are here and not under Adverts.
      { href: "/console/advertising", label: "Advertising Page" },
      { href: "/console/pages", label: "Page Layouts" },
      // Feature flags — switch parts of the site on or off (lib/feature-flags.ts).
      { href: "/console/features", label: "Features" },
      // The homepage stats band's third figure, typed in with per-platform guidance (issue #4).
      { href: "/console/social-reach", label: "Social Reach" },
      { href: "/console/categories", label: "News Categories" },
      { href: "/console/industries", label: "Industries" },
      { href: "/console/media", label: "Media Library" },
      { href: "/console/resources", label: "Member Resources" },
      { href: "/console/email-templates", label: "Email Templates" },
    ],
  },
];

// Internal tool — admin only, so it's appended per-role rather than living
// in the module-level array.
const DEV_SECTION: NavSection = { key: "dev", href: "/console/dev", label: "Dev Board" };
// Developer-only, not merely admin: Jas is an admin too, and the error log is
// not his to see (docs/logging.md). Gated by the DEVELOPER_EMAILS allowlist.
const ERRORS_SECTION: NavSection = { key: "errors", href: "/console/errors", label: "Errors" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();
  const name = user.displayName ?? user.email;
  const nav = [
    ...CONSOLE_SECTIONS,
    ...(isAdmin(user) ? [DEV_SECTION] : []),
    ...(isDeveloper(user) ? [ERRORS_SECTION] : []),
  ];

  // The layout is already force-dynamic, so the unread count stays fresh on
  // every navigation without any client polling.
  //
  // Counts BOTH categories, deliberately (fix-list 71). The bell opens
  // /console/notifications on its All tab, so the badge and the list it opens
  // have to agree — a bell counting only messages would hide the notification
  // stream entirely, and a badge that disagrees with its own page is worse than
  // no badge. The messages-only signal is the Inbox card on the Command Centre,
  // which is now scoped to category 'message'.
  const { count } = await serviceDb()
    .from("inbox_messages")
    .select("*", { count: "exact", head: true })
    .eq("read", false);
  const unread = count ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="bg-chrome text-white">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          {/* The lockup always exits to the public homepage — /console itself
              is one click away as Command Centre in the nav below. */}
          <Link href="/" className="font-bold">SMI <span className="text-brand">Console</span></Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href="/console/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              title="Notifications"
              className="tap relative rounded p-2 hover:bg-chrome-hover"
            >
              <IconBell width={20} height={20} strokeWidth={2} />
              {unread > 0 && (
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-xs font-bold leading-4 text-ink">
                  {unread}
                </span>
              )}
            </Link>
            {THEME_SWITCHER_ENABLED && <ThemeSwitcher compact />}
            <AccountMenu name={name} links={accountLinks(user)} signOutAction={signOut} />
          </div>
        </div>
        <ConsoleNav items={nav} />
      </header>
      <main id="main" className="min-w-0 flex-1 bg-paper p-4 sm:p-6">{children}</main>
    </div>
  );
}
