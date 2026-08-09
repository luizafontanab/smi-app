import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/member/profile", icon: "🏢", title: "Update your page", sub: "Description, images, video, socials" },
  { href: "/member/story/new", icon: "📰", title: "Add a story", sub: "Your news on SMI's channels" },
  { href: "/member/event/new", icon: "📅", title: "Add an event", sub: "Open days, shows, launches" },
  { href: "/member/stats", icon: "📈", title: "View statistics", sub: "Who's engaging with you" },
  { href: "/member/buy", icon: "⭐", title: "Buy visibility", sub: "Featured slots & newsletter" },
  { href: "/member/billing", icon: "🧾", title: "Billing", sub: "Invoices & membership" },
];

export default async function MemberDashboard(props: PageProps<"/member">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();

  const [{ data: lastStory }, { data: pending }, { data: notifications }] = await Promise.all([
    db.from("stories").select("published_at").eq("member_id", user.memberId).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("stories").select("id, title, status, rejected_reason").eq("member_id", user.memberId).in("status", ["awaiting_approval", "rejected"]).order("created_at", { ascending: false }).limit(3),
    db.from("notifications").select("kind, payload, created_at").eq("member_id", user.memberId).order("created_at", { ascending: false }).limit(4),
  ]);

  // nudge: "the last time you posted a story was six months ago"
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthsSince = lastStory?.published_at
    ? Math.floor((now - new Date(lastStory.published_at).getTime()) / (30 * 864e5))
    : null;
  const submitted = typeof sp.submitted === "string" ? sp.submitted : null;

  return (
    <div>
      {submitted && (
        <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {submitted === "welcome" && "Welcome to SMI! Complete your company page below — it goes live in the directory once the editor approves it."}
          {submitted === "story" && "Story submitted — it goes live once the editor approves it, and we'll email you."}
          {submitted === "event" && "Event submitted for approval."}
          {submitted === "profile" && "Page changes submitted — they appear once approved."}
          {submitted === "buy" && "Request received — Jas will confirm and invoice you."}
        </p>
      )}

      <h1 className="text-2xl font-bold text-navy">Welcome back</h1>
      {monthsSince !== null && monthsSince >= 3 && (
        <p className="mt-2 rounded-lg border-2 border-amber bg-amber/10 p-3 text-sm">
          The last time you posted a story was <b>{monthsSince} months ago</b> — your page works harder when it&apos;s fresh.{" "}
          <Link href="/member/story/new" className="font-semibold text-steel underline">Add one now →</Link>
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl bg-white p-5 text-center shadow-sm transition hover:shadow-md">
            <span className="text-3xl">{c.icon}</span>
            <p className="mt-2 font-bold text-navy">{c.title}</p>
            <p className="mt-1 text-xs text-gray-500">{c.sub}</p>
          </Link>
        ))}
      </div>

      {(pending ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-navy">Your submissions</h2>
          {(pending ?? []).map((s) => (
            <p key={s.id} className="mt-2 border-t pt-2 text-sm">
              {s.title} —{" "}
              {s.status === "awaiting_approval"
                ? <span className="text-amber">awaiting approval</span>
                : <span className="text-red-600">not published{s.rejected_reason && `: ${s.rejected_reason}`}</span>}
            </p>
          ))}
        </section>
      )}

      {(notifications ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-navy">Recent updates</h2>
          {(notifications ?? []).map((n, i) => (
            <p key={i} className="mt-2 border-t pt-2 text-sm text-gray-600">
              {n.created_at.slice(0, 10)} — {n.kind === "story_live" ? "Your story went live 🎉" : n.kind === "story_rejected" ? "A story needs changes" : n.kind}
            </p>
          ))}
        </section>
      )}

      <p className="mt-6 text-center text-xs text-gray-400">
        <Link href="/member/resources" className="underline">Download your &quot;proud member&quot; graphic</Link> · <Link href="/member/settings" className="underline">Notification settings</Link>
      </p>
    </div>
  );
}
