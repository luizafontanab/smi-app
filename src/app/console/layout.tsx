import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ConsoleNav, type NavItem } from "@/components/console/ConsoleNav";
import { requireConsole } from "@/lib/auth";
import { sessionDb } from "@/lib/db/server";
import { SkipLink } from "@/components/SkipLink";

export const dynamic = "force-dynamic";

// Wireframe module order first; the modules built beyond the wireframe ship
// muted at the end, still reachable.
const CONSOLE_NAV: NavItem[] = [
  { href: "/console", label: "Command Centre" },
  { href: "/console/adverts", label: "Adverts & Inventory" },
  { href: "/console/members", label: "Members & CRM" },
  { href: "/console/stories", label: "Story Engine (CMS)" },
  { href: "/console/newsletter", label: "Newsletter" },
  { href: "/console/machines", label: "Featured Machine", muted: true },
  { href: "/console/content-pages", label: "Content Pages", muted: true },
  { href: "/console/pages", label: "Page Layouts", muted: true },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Editor",
  approver: "Approver",
  viewer: "Viewer",
  input_only: "Contributor",
};

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();
  const name = user.displayName ?? user.email;
  const roleLabel = ROLE_LABELS[user.role] ?? user.role.replace("_", " ");

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
        <ConsoleNav items={CONSOLE_NAV} />
      </header>
      <main id="main" className="min-w-0 flex-1 bg-paper p-6">{children}</main>
    </div>
  );
}
