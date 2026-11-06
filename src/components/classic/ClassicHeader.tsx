import Link from "next/link";
import { signOut } from "@/app/actions";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "@/lib/social";
import { AccountMenu } from "@/components/AccountMenu";
import { IconAccount, IconSearch } from "@/components/icons";
import { MobileNav } from "@/components/MobileNav";
import { SocialIcon } from "@/components/social-icons";
import { accountLinks, type SiteHeader } from "@/components/SiteHeader";
import { Wordmark } from "@/components/Wordmark";
import { ClassicMenu } from "@/components/classic/ClassicMenu";

/**
 * Classic's site header (hook point `Header` in src/components/design-option.ts;
 * spec #68, #71): the live site's grey top bar, then its black sticky bar with
 * the wide logo and the flat menu.
 *
 * Built from Current's own pieces (AccountMenu with the unread count,
 * MobileNav, Wordmark, the social icons), so the menus behave as they do on
 * Current. Layout and colour live in the #71 section of classic.css, which
 * reaches this markup through its data-part labels; no Tailwind here except
 * the one thing MobileNav only takes as a class (its trigger's breakpoint).
 *
 * Same props as Current's SiteHeader. `tone` is ignored: the bar is always
 * black, so the mark is always the dark-surface artwork.
 */
export function ClassicHeader({ user, unread = 0 }: React.ComponentProps<typeof SiteHeader>) {
  const name = user ? user.displayName ?? user.email : "";
  const links = user ? accountLinks(user, unread) : [];
  return (
    <>
      {/* Hidden below 440px by classic.css, like the live site's. Nothing in it
          is lost on a phone: the footer carries the socials and these links. */}
      <div data-part="site-topbar">
        <ul data-part="site-topbar-socials">
          {SOCIAL_CHANNELS.map((c) => (
            <li key={c.key}>
              <a href={SMI_SOCIAL_URLS[c.key]} target="_blank" rel="noopener" aria-label={c.label}>
                <SocialIcon channel={c.key} />
              </a>
            </li>
          ))}
        </ul>
        <nav data-part="site-topbar-links" aria-label="About SMI">
          <Link href="/pages/policies">Policies</Link>
          <Link href="/pages/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
      <header data-part="site-header">
        <div data-part="site-header-bar">
          <Link href="/" data-part="site-logo"><Wordmark tone="dark" /></Link>
          <nav data-part="site-nav" aria-label="Main">
            {/* Shown from 80rem, where all nine fit beside the mark. */}
            <ClassicMenu />
            <Link href="/search" data-part="site-search" aria-label="Search">
              <IconSearch width={22} height={22} />
            </Link>
            {user ? (
              <AccountMenu name={name} links={links} signOutAction={signOut} unread={unread} />
            ) : (
              // No Join button: the live bar has none, and the orange band above
              // the footer and the drawer both offer it. /dashboard sends a
              // signed-out visitor to log in.
              <Link href="/dashboard" data-part="site-login" aria-label="Member login">
                <IconAccount width={22} height={22} />
              </Link>
            )}
            {/* Current's drawer, below the width where the flat menu fits. Its
                trigger hides itself at lg; Classic needs it up to xl (80rem,
                the breakpoint classic.css shows the flat menu at). */}
            <MobileNav user={user} accountLinks={links} signOutAction={signOut} triggerClassName="hover:bg-white/10 lg:inline-flex! xl:hidden!" />
          </nav>
        </div>
      </header>
    </>
  );
}
