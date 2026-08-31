import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your statistics" };

/**
 * The agreed stats panel (USE-CASES gap 6): kept chart names, honest numbers,
 * impressions + cumulative counts carry the headline. Region always shown;
 * company appears when the resolver layer is enabled.
 */
export default async function MemberStatsPage() {
  const user = await requireMember();
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthAgo = new Date(now - 30 * 864e5).toISOString();
  const yearAgo = new Date(now - 365 * 864e5).toISOString();

  const [pageViewsMonth, pageViewsYear, myStories, storyViews, myAdverts, audit] = await Promise.all([
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", monthAgo),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", yearAgo),
    db.from("stories").select("id", { count: "exact" }).eq("member_id", user.memberId).eq("status", "published"),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "story_view").eq("member_id", user.memberId),
    db.from("adverts").select("id").eq("member_id", user.memberId),
    db.from("engagement_audit").select("occurred_on, region, company, page, views").eq("member_id", user.memberId).order("occurred_on", { ascending: false }).limit(20),
  ]);

  const advertIds = (myAdverts.data ?? []).map((a) => a.id);
  let impressions = 0, clicks = 0;
  if (advertIds.length) {
    const [imp, clk] = await Promise.all([
      db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_impression").in("advert_id", advertIds).gte("occurred_at", yearAgo),
      db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_click").in("advert_id", advertIds).gte("occurred_at", yearAgo),
    ]);
    impressions = imp.count ?? 0;
    clicks = clk.count ?? 0;
  }

  // newsletter value: issues that carried one of this member's stories
  const storyIds = (myStories.data ?? []).map((s) => s.id);
  let featuredIn = 0;
  if (storyIds.length) {
    const { count } = await db.from("newsletter_items").select("*", { count: "exact", head: true }).in("story_id", storyIds);
    featuredIn = count ?? 0;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Your statistics</h1>
      <p className="mt-1 text-sm text-gray-500">Real, unpadded numbers, measured on SMI&apos;s own platform.</p>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Page performance" value={pageViewsMonth.count ?? 0} sub={`${pageViewsYear.count ?? 0} in 12 months`} />
        <Stat label="Advert impressions" value={impressions} sub="pages your brand appeared on (12 mo)" />
        <Stat label="Clicks overview" value={clicks} sub="advert clicks (12 mo)" />
        <Stat label="Story reach" value={storyViews.count ?? 0} sub={`${myStories.count ?? 0} stories, all-time views`} />
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Newsletter value</h2>
        <p className="mt-1 text-sm text-gray-600">
          Your stories featured in <b>{featuredIn}</b> newsletter issue{featuredIn === 1 ? "" : "s"} reaching ~2,500 trade readers each.
        </p>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Who&apos;s engaging</h2>
        <p className="mt-1 text-xs text-gray-400">
          Companies and regions are resolved from network data, not personal information — indicative interest, not a confirmed buyer.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Date</th><th>Who</th><th>Where</th><th>Views</th></tr></thead>
          <tbody>
            {(audit.data ?? []).map((a, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5 text-gray-400">{a.occurred_on}</td>
                <td className="font-medium">{a.company ?? <span className="font-normal text-gray-400">Company unknown</span>}</td>
                <td>{a.region ?? "—"}</td>
                <td>{a.views}</td>
              </tr>
            ))}
            {(audit.data ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-gray-400">No engagement recorded yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}
