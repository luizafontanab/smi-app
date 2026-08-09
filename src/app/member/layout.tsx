import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb, sessionDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();
  const { data: member } = await serviceDb().from("members").select("name, slug, status").eq("id", user.memberId).single();

  async function signOut() {
    "use server";
    const db = await sessionDb();
    await db.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/member" className="font-bold">SMI <span className="text-amber">Member Area</span></Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/60">{member?.name}</span>
            {member?.slug && <Link href={`/members/${member.slug}`} className="hover:text-amber">Public page →</Link>}
            <form action={signOut}><button className="text-white/60 hover:text-white">Sign out</button></form>
          </div>
        </div>
        {member?.status === "grace" && (
          <div className="bg-amber py-1.5 text-center text-sm font-medium text-navy">
            Your membership payment is overdue — your page stays live during the grace period. Please update payment or contact us.
          </div>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
