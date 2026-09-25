import Link from "next/link";
import { signOut } from "@/app/actions";
import { isAdmin, type CurrentUser } from "@/lib/auth";
import { AccountMenu } from "@/components/AccountMenu";
import { IconSearch } from "@/components/icons";
import { MediaMenu } from "@/components/MediaMenu";
import { MobileNav } from "@/components/MobileNav";
import { Wordmark } from "@/components/Wordmark";

const MEDIA_ITEMS = [
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/pages/mach-publication", label: "Magazine" },
  { href: "/advertising", label: "Advertising" },
];

const MEMBERS_ITEMS = [
  { href: "/member", label: "Find a member" },
  { href: "/join", label: "Join" },
];

/** The signed-in account menu, by role — members also get notifications and help. */
export function accountLinks(user: CurrentUser, unread = 0) {
  // Admins are deliberately not given a member notification count — their
  // unread signal is the console header's inbox_messages bell.
  return isAdmin(user)
    ? [
        { href: "/console", label: "Admin console" },
        { href: "/console/notifications", label: "Notifications" },
      ]
    : [
        { href: "/dashboard", label: "Member area" },
        { href: "/dashboard/notifications", label: "Notifications", badge: unread || undefined },
        { href: "/dashboard/help", label: "Help" },
      ];
}

/** Session comes from the public layout — this stays presentational. */
export function SiteHeader({ user, unread = 0 }: { user: CurrentUser | null; unread?: number }) {
  const name = user ? user.displayName ?? user.email : "";
  const links = user ? accountLinks(user, unread) : [];
  return (
    <header className="border-b bg-chrome text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/"><Wordmark /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {/* Below lg, MobileNav's drawer already carries every one of these
              links (including Search) — showing both would crowd a phone-
              width header for no reason. */}
          <MediaMenu label="Media" items={MEDIA_ITEMS} />
          {/* The dropdown's Join entry is navigation; the logged-out
              "Become a Member" CTA below stays as the call to action. */}
          <MediaMenu label="Members" items={MEMBERS_ITEMS} className="hidden sm:block" />
          <Link href="/featured-machine" className="tap hidden rounded px-3 py-2 hover:bg-chrome-hover md:block">Featured Machine</Link>
          <Link href="/event" className="tap hidden rounded px-3 py-2 hover:bg-chrome-hover md:block">Events</Link>
          <Link href="/search" className="tap hidden rounded px-3 py-2 hover:bg-chrome-hover lg:block" aria-label="Search">
            <IconSearch width={18} height={18} />
          </Link>
          <MobileNav user={user} accountLinks={links} signOutAction={signOut} />
          {user ? (
            <AccountMenu name={name} links={links} signOutAction={signOut} unread={unread} />
          ) : (
            <>
              <Link href="/join" className="tap rounded bg-brand px-3 py-2 font-semibold text-ink hover:brightness-110">
                Become a Member
              </Link>
              <Link href="/dashboard" className="tap rounded border border-white/30 px-3 py-2 hover:bg-chrome-hover">Login</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
