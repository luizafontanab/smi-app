import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ConsoleNav, type NavSection } from "@/components/console/ConsoleNav";
import { isAdmin, requireConsole } from "@/lib/auth";
import { sessionDb } from "@/lib/db/server";
import { SkipLink } from "@/components/SkipLink";

export const dynamic = "force-dynamic";

// Two-tier nav: row 1 is these sections, row 2 (always rendered) shows
// whichever section's children match the current route. Leaf sections (no
// children) behave like a plain link and leave row 2 empty.
const CONSOLE_SECTIONS: NavSection[] = [
  { key: "home", href: "/console", label: "Command Centre" },
  {
    key: "cms",
    href: "/console/stories",
    label: "CMS",
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
      { href: "/console/adverts/spots", label: "Ad Spots" },
    ],
  },
  {
    key: "members",
    href: "/console/members",
    label: "Members & CRM",
    children: [
      { href: "/console/members", label: "Members" },
      { href: "/console/crm", label: "CRM" },
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
    ],
  },
];

// Internal tool — admin only, so it's appended per-role rather than living
// in the module-level array.
const DEV_SECTION: NavSection = { key: "dev", href: "/console/dev", label: "Dev Board" };

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
};

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();
  const name = user.displayName ?? user.email;
  const roleLabel = ROLE_LABELS[user.role] ?? user.role.replace("_", " ");
  const nav = isAdmin(user) ? [...CONSOLE_SECTIONS, DEV_SECTION] : CONSOLE_SECTIONS;

  async function signOut() {
    "use server";
    const db = await sessionDb();
    await db.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="bg-chrome text-white">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/console" className="font-bold">SMI <span className="text-brand">Console</span></Link>
          <div className="flex items-center gap-4 text-xs text-white/70">
            <span>Signed in as {name} · {roleLabel}</span>
            <Link href="/" className="hover:text-white">View public site</Link>
            <form action={signOut}>
              <button className="hover:text-white">Sign out</button>
            </form>
            <ThemeSwitcher compact />
          </div>
        </div>
        <ConsoleNav items={nav} />
      </header>
      <main id="main" className="min-w-0 flex-1 bg-paper p-6">{children}</main>
    </div>
  );
}
