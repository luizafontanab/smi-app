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

/** A member's account menu. The member area always shows this one — including to an admin viewing as a member. */
export function memberAccountLinks(unread = 0) {
  return [
    { href: "/dashboard", label: "Member area" },
    { href: "/dashboard/notifications", label: "Notifications", badge: unread || undefined },
    { href: "/dashboard/help", label: "Help" },
  ];
}

/** The signed-in account menu, by role — members also get notifications and help. */
export function accountLinks(user: CurrentUser, unread = 0) {
  // Admins are deliberately not given a member notification count — their
  // unread signal is the console header's inbox_messages bell.
  return isAdmin(user)
    ? [
        { href: "/console", label: "Admin console" },
        { href: "/console/notifications", label: "Notifications" },
        { href: "/console/releases", label: "What's new" },
      ]
    : memberAccountLinks(unread);
}

/**
 * One structure, two tones. "dark" is forge's near-black chrome; "light" is
 * the grid design's white bar from the client's comps. Grid used to have its
 * own header (a search field over a grey link bar); it now shares this one so
 * both designs keep their menus to the right of the mark, and only colour
 * differs. The industry strip stays a separate secondary nav (IndustryBar).
 */
const TONES = {
  dark: {
    header: "border-b bg-chrome text-white",
    hover: "hover:bg-chrome-hover",
    login: "border-white/30 hover:bg-chrome-hover",
  },
  light: {
    header: "border-b border-line bg-white text-ink",
    // chrome-hover would paint near-black behind ink text on this bar.
    hover: "hover:bg-shade",
    login: "border-graphite/30 hover:bg-shade",
  },
} as const;

export type HeaderTone = keyof typeof TONES;

/** Session comes from the public layout — this stays presentational. */
export function SiteHeader({ user, unread = 0, tone = "dark" }: { user: CurrentUser | null; unread?: number; tone?: HeaderTone }) {
  const name = user ? user.displayName ?? user.email : "";
  const links = user ? accountLinks(user, unread) : [];
  const t = TONES[tone];
  return (
    <header className={t.header}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* The supplied wide mark is orange + white; "light" is the same
            artwork with its wordmark path in ink, for a pale bar. */}
        <Link href="/"><Wordmark tone={tone} /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {/* Below lg, MobileNav's drawer already carries every one of these
              links (including Search) — showing both would crowd a phone-
              width header for no reason. */}
          <MediaMenu label="Media" items={MEDIA_ITEMS} tone={tone} />
          {/* The dropdown's Join entry is navigation; the logged-out
              "Become a Member" CTA below stays as the call to action. */}
          <MediaMenu label="Members" items={MEMBERS_ITEMS} className="hidden sm:block" tone={tone} />
          <Link href="/featured-machine" className={`tap hidden rounded px-3 py-2 md:block ${t.hover}`}>Featured Machine</Link>
          <Link href="/event" className={`tap hidden rounded px-3 py-2 md:block ${t.hover}`}>Events</Link>
          <Link href="/search" className={`tap hidden rounded px-3 py-2 lg:block ${t.hover}`} aria-label="Search">
            <IconSearch width={18} height={18} />
          </Link>
          <MobileNav user={user} accountLinks={links} signOutAction={signOut} triggerClassName={t.hover} />
          {user ? (
            <AccountMenu name={name} links={links} signOutAction={signOut} unread={unread} />
          ) : (
            <>
              <Link href="/join" className="tap rounded bg-brand px-3 py-2 font-semibold text-ink hover:brightness-110">
                Become a Member
              </Link>
              <Link href="/dashboard" className={`tap rounded border px-3 py-2 ${t.login}`}>Login</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
