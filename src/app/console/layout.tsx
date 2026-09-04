import Link from "next/link";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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
// children) behave like a plain link and leave row 2 empty. Messages left
// the nav for the header bell — see the notification link below.
const CONSOLE_SECTIONS: NavSection[] = [
  { key: "home", href: "/console", label: "Command Centre" },
  { key: "analytics", href: "/console/analytics", label: "Analytics" },
  {
    key: "cms",
    href: "/console/stories",
    label: "Content",
    children: [
      { href: "/console/stories", label: "Story Engine" },
      { href: "/console/videos", label: "Video Engine" },
      { href: "/console/events", label: "Events" },
      { href: "/console/newsletter", label: "Newsletter" },
    ],
  },
  {
    key: "adverts",
    href: "/console/adverts",
    label: "Adverts & Inventory",
    children: [
      { href: "/console/adverts", label: "Bookings" },
      { href: "/console/adverts/artwork", label: "Artwork" },
      { href: "/console/adverts/spots", label: "Ad Spots" },
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
      { href: "/console/pages", label: "Page Layouts" },
      { href: "/console/categories", label: "Categories" },
      { href: "/console/media", label: "Media Library" },
      { href: "/console/resources", label: "Member Resources" },
    ],
  },
];

// Internal tool — admin only, so it's appended per-role rather than living
// in the module-level array.
const DEV_SECTION: NavSection = { key: "dev", href: "/console/dev", label: "Dev Board" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();
  const name = user.displayName ?? user.email;
  const nav = isAdmin(user) ? [...CONSOLE_SECTIONS, DEV_SECTION] : CONSOLE_SECTIONS;

  // The layout is already force-dynamic, so the unread count stays fresh on
  // every navigation without any client polling.
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
              href="/console/messages"
              aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
              title="Messages"
              className="tap relative rounded p-2 hover:bg-chrome-hover"
            >
              <IconBell width={20} height={20} strokeWidth={2} />
              {unread > 0 && (
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-xs font-bold leading-4 text-ink">
                  {unread}
                </span>
              )}
            </Link>
            <ThemeSwitcher compact />
            <AccountMenu name={name} links={accountLinks(user)} signOutAction={signOut} />
          </div>
        </div>
        <ConsoleNav items={nav} />
      </header>
      <main id="main" className="min-w-0 flex-1 bg-paper p-4 sm:p-6">{children}</main>
    </div>
  );
}
