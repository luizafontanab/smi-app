import Link from "next/link";
import { signOut } from "@/app/actions";
import type { CurrentUser } from "@/lib/auth";
import { AccountMenu } from "@/components/AccountMenu";
import { IconSearch } from "@/components/icons";
import { MobileNav } from "@/components/MobileNav";
import { accountLinks } from "@/components/SiteHeader";
import { Wordmark } from "@/components/Wordmark";

/**
 * The grid design's header, from the client's comps (docs/Sheet Metal
 * Industries Home v1.png / v2.png): a white identity row carrying the mark and
 * a search field, over a light-grey nav bar. Forge keeps the near-black
 * SiteHeader — the public layout picks between them on the theme cookie.
 *
 * Two deliberate differences from SiteHeader:
 *   · The nav is a flat row of links, not Media/Members dropdowns. That is the
 *     comps' shape, and it keeps MediaMenu's chrome-coloured popup out of a
 *     light bar. Every link the dropdowns held is present here or in the
 *     mobile drawer, so nothing became unreachable.
 *   · Search is in the header rather than on the page. The grid homepage packs
 *     its above-the-fold area, and the comps put the field here.
 *
 * The signed-in menu and the mobile drawer stay shared with forge (AccountMenu,
 * MobileNav, accountLinks) so there is one implementation of each.
 */

const NAV_ITEMS = [
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/member", label: "Find a member" },
  { href: "/featured-machine", label: "Featured Machine" },
  { href: "/event", label: "Events" },
  { href: "/advertising", label: "Advertising" },
  { href: "/pages/mach-publication", label: "MACH Publication" },
];

/** Session comes from the public layout — this stays presentational. */
export function GridSiteHeader({ user, unread = 0 }: { user: CurrentUser | null; unread?: number }) {
  const name = user ? user.displayName ?? user.email : "";
  const links = user ? accountLinks(user, unread) : [];
  return (
    <>
    {/* relative z-40 so the account dropdown, which opens downward across the
        sticky nav below, paints over it rather than behind it. */}
    <header className="relative z-40 bg-white text-ink">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/">
          {/* The supplied wide mark is orange + white; "light" is the same
              artwork with its wordmark path in ink, for this pale bar. */}
          <Wordmark tone="light" />
        </Link>
        <div className="flex items-center gap-2">
          <form action="/search" className="hidden items-center sm:flex">
            <label htmlFor="grid-header-search" className="sr-only">Search the site</label>
            <input
              id="grid-header-search"
              name="q"
              type="search"
              placeholder="Search news, members, machines…"
              className="w-44 min-w-0 rounded-l-full border border-r-0 border-line bg-shade px-4 py-2 text-sm md:w-64"
            />
            <button aria-label="Search" className="rounded-r-full border border-line bg-shade px-3 py-2 text-graphite hover:bg-line hover:text-ink">
              <IconSearch width={18} height={18} />
            </button>
          </form>
          {/* chrome-hover would paint near-black behind ink text on this bar. */}
          <MobileNav user={user} accountLinks={links} signOutAction={signOut} triggerClassName="hover:bg-shade" />
          {user && <AccountMenu name={name} links={links} signOutAction={signOut} unread={unread} />}
        </div>
      </div>

    </header>

    {/* A sibling of <header>, not a child: a sticky element only sticks while
        its containing block is on screen, so nested in the header it would
        unstick the moment the logo row scrolled away. Out here its containing
        block is the public layout's full-height column. */}
    {/* Hidden below lg for a signed-in user, because there it holds nothing:
        the nav is lg-only and the Login / Join buttons are for signed-out
        visitors, so it would render as a bare grey strip stuck to the top of
        every page. Nothing is lost — MobileNav carries the same section links
        at those widths. */}
    <div className={`sticky top-0 z-30 border-y border-line bg-[var(--gh-band)]${user ? " hidden lg:block" : ""}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4">
          <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="tap border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold hover:border-brand hover:text-brand-text"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {!user && (
            <div className="ml-auto flex items-center gap-2 py-1.5">
              <Link href="/dashboard" className="tap rounded-[var(--gh-radius)] border border-graphite/30 px-3 py-2 text-sm font-semibold hover:bg-white">
                Login
              </Link>
              {/* Ink on orange, never white — see the contrast note in grid-home/ui.tsx. */}
              <Link href="/join" className="tap rounded-[var(--gh-radius)] bg-brand px-3 py-2 text-sm font-bold text-ink hover:brightness-110">
                Become a Member
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
