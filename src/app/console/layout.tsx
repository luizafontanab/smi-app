import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { sessionDb } from "@/lib/db/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/console", label: "Command Centre" },
  { href: "/console/stories", label: "Story Engine" },
  { href: "/console/adverts", label: "Adverts & Inventory" },
  { href: "/console/members", label: "Members & CRM" },
  { href: "/console/newsletter", label: "Newsletter" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsole();

  async function signOut() {
    "use server";
    const db = await sessionDb();
    await db.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-navy text-white">
        <div className="p-4">
          <Link href="/console" className="font-bold">SMI <span className="text-amber">Console</span></Link>
          <p className="mt-1 text-xs text-white/50">{user.displayName ?? user.email} · {user.role.replace("_", " ")}</p>
        </div>
        <nav className="mt-2 flex flex-col text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="px-4 py-2.5 hover:bg-steel">{n.label}</Link>
          ))}
          <Link href="/" className="px-4 py-2.5 text-white/60 hover:bg-steel">← Public site</Link>
          <form action={signOut}>
            <button className="w-full px-4 py-2.5 text-left text-white/60 hover:bg-steel">Sign out</button>
          </form>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 bg-paper p-6">{children}</main>
    </div>
  );
}
