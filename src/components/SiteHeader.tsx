import Link from "next/link";

const MEDIA_ITEMS = [
  { href: "/news", label: "News" },
  { href: "/videos", label: "Videos" },
  { href: "/newsletters", label: "Newsletters" },
  { href: "/pages/mach-publication", label: "Magazine" },
];

export function SiteHeader() {
  return (
    <header className="border-b bg-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Sheet Metal <span className="text-amber">Industries</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <div className="group relative">
            <button className="rounded px-3 py-2 hover:bg-steel" aria-haspopup="true">
              Media ▾
            </button>
            <div className="invisible absolute left-0 z-20 w-44 rounded-b bg-navy py-1 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              {MEDIA_ITEMS.map((i) => (
                <Link key={i.href} href={i.href} className="block px-4 py-2 hover:bg-steel">
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
          <Link href="/members" className="hidden rounded px-3 py-2 hover:bg-steel sm:block">Members</Link>
          <Link href="/featured-machine" className="hidden rounded px-3 py-2 hover:bg-steel md:block">Featured Machine</Link>
          <Link href="/events" className="hidden rounded px-3 py-2 hover:bg-steel md:block">Events</Link>
          <Link href="/advertising" className="hidden rounded px-3 py-2 hover:bg-steel lg:block">Advertising</Link>
          <Link href="/search" className="rounded px-3 py-2 hover:bg-steel" aria-label="Search">🔍</Link>
          <Link href="/join" className="rounded bg-amber px-3 py-2 font-semibold text-navy hover:brightness-110">
            Become a Member
          </Link>
          <Link href="/member" className="rounded border border-white/30 px-3 py-2 hover:bg-steel">Login</Link>
        </nav>
      </div>
    </header>
  );
}
