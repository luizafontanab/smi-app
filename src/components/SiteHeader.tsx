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
export function accountLinks(user: CurrentUser) {
  return isAdmin(user)
    ? [
        { href: "/console", label: "Admin console" },
        { href: "/console/messages", label: "Notifications" },
      ]
    : [
        { href: "/dashboard", label: "Member area" },
        { href: "/dashboard/notifications", label: "Notifications" },
        { href: "/dashboard/help", label: "Help" },
      ];
}

/** Session comes from the public layout — this stays presentational. */
export function SiteHeader({ user }: { user: CurrentUser | null }) {
  const name = user ? user.displayName ?? user.email : "";
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
          <MobileNav user={user} accountLinks={user ? accountLinks(user) : []} signOutAction={signOut} />
          {user ? (
            <AccountMenu name={name} links={accountLinks(user)} signOutAction={signOut} />
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
