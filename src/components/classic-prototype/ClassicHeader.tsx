import Link from "next/link";
import { signOut } from "@/app/actions";
import type { CurrentUser } from "@/lib/auth";
import { AccountMenu } from "@/components/AccountMenu";
import { IconAccount, IconSearch } from "@/components/icons";
import { MediaMenu } from "@/components/MediaMenu";
import { MobileNav } from "@/components/MobileNav";
import { SocialIcon } from "@/components/social-icons";
import { Wordmark } from "@/components/Wordmark";
import { accountLinks } from "@/components/SiteHeader";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { ClassicNavLink } from "./ClassicNavLink";

/*
 * PROTOTYPE (issue #59). Two shapes of the live site's header:
 *   "faithful" (A, C): grey top bar with the 4px orange rule + a tall black
 *     bar with the live site's flat nine-link menu, current item underlined.
 *   "adapted" (B): just the black bar, our own grouped menus kept.
 * Accessibility: no tabindex games, focus styles stay (globals.css).
 */
const FLAT = [
  { href: "/", label: "Home" },
  { href: "/advertising", label: "Advertising" },
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/member", label: "Members" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/featured-machine", label: "Featured Machine" },
  { href: "/event", label: "Events" },
  { href: "/pages/mach-publication", label: "Magazine" },
];

export function ClassicHeader({ user, unread = 0, shape }: { user: CurrentUser | null; unread?: number; shape: "faithful" | "adapted" }) {
  const name = user ? user.displayName ?? user.email : "";
  const links = user ? accountLinks(user, unread) : [];
  return (
    <>
      {shape === "faithful" && (
        <div className="hidden border-t-4 border-brand bg-[#555] text-sm text-white sm:block">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6 py-2.5">
            <p className="truncate text-white/90">
              <span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-brand text-[10px] text-ink" aria-hidden="true">▶</span>
              <span className="uppercase">Trending:</span> the newest story headline would tick here
            </p>
            <div className="flex shrink-0 items-center gap-4">
              {SOCIAL_CHANNELS.map((c) => (
                <a key={c.key} href={SMI_SOCIAL_URLS[c.key]} aria-label={c.label} className="opacity-60 hover:opacity-100" target="_blank" rel="noopener">
                  <SocialIcon channel={c.key} className="h-4 w-4" />
                </a>
              ))}
              <span className="flex gap-4 border-l border-white/30 pl-4">
                <Link href="/pages/policies" className="hover:text-brand">Policies</Link>
                <Link href="/pages/about" className="hover:text-brand">About</Link>
                <Link href="/contact" className="hover:text-brand">Contact</Link>
              </span>
            </div>
          </div>
        </div>
      )}
      <header className={`sticky top-0 z-40 bg-black text-white ${shape === "faithful" ? "" : "border-b-4 border-brand"}`}>
        <div className={`mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 ${shape === "faithful" ? "min-h-[92px]" : "min-h-[76px]"}`}>
          <Link href="/" className="shrink-0"><Wordmark tone="dark" /></Link>
          <nav className="flex min-w-0 items-center gap-5 whitespace-nowrap">
            {shape === "faithful" ? (
              <div className="hidden items-center gap-5 xl:flex">
                {FLAT.map((l) => <ClassicNavLink key={l.href} href={l.href}>{l.label}</ClassicNavLink>)}
              </div>
            ) : (
              <div className="hidden items-center gap-1 text-[1.0625rem] lg:flex">
                <MediaMenu label="Media" items={FLAT.slice(1, 4).concat(FLAT.slice(5, 6), FLAT.slice(8))} className="block" tone="dark" />
                <MediaMenu label="Members" items={[{ href: "/member", label: "Find a member" }, { href: "/join", label: "Join" }]} className="block" tone="dark" />
                <span className="px-2"><ClassicNavLink href="/featured-machine">Featured Machine</ClassicNavLink></span>
                <span className="px-2"><ClassicNavLink href="/event">Events</ClassicNavLink></span>
              </div>
            )}
            <Link href="/search" aria-label="Search" className="hidden rounded p-2 text-[#b4b4b4] hover:text-white lg:inline-flex"><IconSearch width={22} height={22} /></Link>
            {user ? (
              <AccountMenu name={name} links={links} signOutAction={signOut} unread={unread} />
            ) : shape === "faithful" ? (
              <Link href="/dashboard" aria-label="Member login" className="hidden rounded p-2 text-[#b4b4b4] hover:text-white sm:inline-flex"><IconAccount width={22} height={22} /></Link>
            ) : (
              <>
                <Link href="/join" className="hidden rounded-[5px] bg-brand px-4 py-2 font-semibold text-ink hover:brightness-110 sm:inline-flex">Become a Member</Link>
                <Link href="/dashboard" className="hidden rounded-[5px] border border-white/30 px-4 py-2 hover:bg-white/10 sm:inline-flex">Login</Link>
              </>
            )}
            {/* MobileNav's trigger hides itself at lg; the flat menu only fits from xl. */}
            <MobileNav user={user} accountLinks={links} signOutAction={signOut} triggerClassName={`hover:bg-white/10 ${shape === "faithful" ? "lg:inline-flex! xl:hidden!" : ""}`} />
          </nav>
        </div>
      </header>
    </>
  );
}
