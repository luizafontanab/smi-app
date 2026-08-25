import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";

const MEDIA_ITEMS = [
  { href: "/news", label: "News" },
  { href: "/video", label: "Videos" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/pages/mach-publication", label: "Magazine" },
];

/** Session comes from the public layout — this stays presentational. */
export function SiteHeader({ user }: { user: CurrentUser | null }) {
  const dashboard = user?.role === "member" ? "/dashboard" : "/console";
  const name = user ? user.displayName ?? user.email : "";
  return (
    <header className="border-b bg-chrome text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* The client's logo face, and only here — Allerta Stencil is a wordmark
            font, not a display font. Everything else is League Spartan. */}
        <Link href="/" className="font-logo text-lg tracking-tight">
          Sheet Metal <span className="text-brand">Industries</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <div className="group relative">
            <button className="rounded px-3 py-2 hover:bg-chrome-hover" aria-haspopup="true">
              Media ▾
            </button>
            <div className="invisible absolute left-0 z-20 w-44 rounded-b bg-chrome py-1 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              {MEDIA_ITEMS.map((i) => (
                <Link key={i.href} href={i.href} className="block px-4 py-2 hover:bg-chrome-hover">
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
          <Link href="/member" className="hidden rounded px-3 py-2 hover:bg-chrome-hover sm:block">Members</Link>
          <Link href="/featured-machine" className="hidden rounded px-3 py-2 hover:bg-chrome-hover md:block">Featured Machine</Link>
          <Link href="/event" className="hidden rounded px-3 py-2 hover:bg-chrome-hover md:block">Events</Link>
          <Link href="/advertising" className="hidden rounded px-3 py-2 hover:bg-chrome-hover lg:block">Advertising</Link>
          <Link href="/search" className="rounded px-3 py-2 hover:bg-chrome-hover" aria-label="Search">🔍</Link>
          {user ? (
            <Link
              href={dashboard}
              title={name}
              className="inline-block max-w-[12rem] truncate rounded bg-brand px-3 py-2 align-middle font-semibold text-ink hover:brightness-110"
            >
              {name}
            </Link>
          ) : (
            <>
              <Link href="/join" className="rounded bg-brand px-3 py-2 font-semibold text-ink hover:brightness-110">
                Become a Member
              </Link>
              <Link href="/dashboard" className="rounded border border-white/30 px-3 py-2 hover:bg-chrome-hover">Login</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
