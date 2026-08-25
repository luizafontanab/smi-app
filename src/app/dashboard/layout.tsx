import Link from "next/link";
import { redirect } from "next/navigation";
import { SkipLink } from "@/components/SkipLink";
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
      <SkipLink />
      <header className="bg-chrome text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="font-bold">SMI <span className="text-brand">Member Area</span></Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/60">{member?.name}</span>
            {member?.slug && (member.status === "active" || member.status === "grace") && (
              <Link href={`/member/${member.slug}`} className="hover:text-brand">Public page →</Link>
            )}
            <form action={signOut}><button className="text-white/60 hover:text-white">Sign out</button></form>
          </div>
        </div>
        {member?.status === "grace" && (
          <div className="bg-brand py-1.5 text-center text-sm font-medium text-ink">
            Your membership payment is overdue — your page stays live during the grace period. Please update payment or contact us.
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
