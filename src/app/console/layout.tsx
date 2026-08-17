import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ConsoleNav, type NavItem } from "@/components/console/ConsoleNav";
import { requireConsole } from "@/lib/auth";
import { sessionDb } from "@/lib/db/server";
import { SkipLink } from "@/components/SkipLink";

export const dynamic = "force-dynamic";

// Wireframe module order first; the two modules built beyond the wireframe
// ship muted at the end (kept reachable in both shells).
const SIDEBAR_NAV: NavItem[] = [
  { href: "/console", label: "Command Centre" },
  { href: "/console/adverts", label: "Adverts & Inventory" },
  { href: "/console/members", label: "Members & CRM" },
  { href: "/console/stories", label: "Story Engine (CMS)" },
  { href: "/console/newsletter", label: "Newsletter" },
  { href: "/console/machines", label: "Featured Machine", muted: true },
  { href: "/console/pages", label: "Page Layouts", muted: true },
];

// The demo-theme top bar mirrors the wireframe's own labels.
const DEMO_NAV: NavItem[] = [
  { href: "/console", label: "Command centre" },
  { href: "/console/adverts", label: "Adverts & inventory" },
  { href: "/console/members", label: "Members & contacts (CRM)" },
  { href: "/console/stories", label: "Story engine (CMS)" },
  { href: "/console/newsletter", label: "Newsletter (CMS)" },
  { href: "/console/machines", label: "Featured machine", muted: true },
  { href: "/console/pages", label: "Page layouts", muted: true },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Editor",
  approver: "Approver",
  viewer: "Viewer",
  input_only: "Contributor",
};

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();
  const theme = (await cookies()).get("smi-theme")?.value;
  const name = user.displayName ?? user.email;
  const roleLabel = ROLE_LABELS[user.role] ?? user.role.replace("_", " ");

  async function signOut() {
    "use server";
    const db = await sessionDb();
    await db.auth.signOut();
    redirect("/login");
  }

  if (theme === "demo") {
    return (
      <div className="flex min-h-screen flex-col">
        <SkipLink />
        <header className="bg-chrome text-white">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/console" className="font-bold">SMI <span className="text-amber">Console</span></Link>
            <div className="flex items-center gap-4 text-xs text-white/70">
              <span>Signed in as {name} · {roleLabel}</span>
              <Link href="/" className="hover:text-white">View public site</Link>
              <form action={signOut}>
                <button className="hover:text-white">Sign out</button>
              </form>
              <ThemeSwitcher compact />
            </div>
          </div>
          <ConsoleNav items={DEMO_NAV} orientation="horizontal" />
        </header>
        <main id="main" className="min-w-0 flex-1 bg-paper p-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <SkipLink />
      <aside className="w-56 shrink-0 bg-chrome text-white">
        <div className="p-4">
          <Link href="/console" className="font-bold">SMI <span className="text-amber">Console</span></Link>
          <p className="mt-1 text-xs text-white/50">{name} — {roleLabel}</p>
        </div>
        <div className="mt-2">
          <ConsoleNav items={SIDEBAR_NAV} orientation="vertical" />
          <div className="mt-2 flex flex-col border-t border-white/10 pt-2 text-sm">
            <Link href="/" className="px-4 py-2.5 text-white/60 hover:bg-chrome-hover">← Public site</Link>
            <form action={signOut}>
              <button className="w-full px-4 py-2.5 text-left text-white/60 hover:bg-chrome-hover">Sign out</button>
            </form>
            <ThemeSwitcher />
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 bg-paper p-6">{children}</main>
    </div>
  );
}
