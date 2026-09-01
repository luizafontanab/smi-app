import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { ChannelBreakdown } from "@/components/ChannelBreakdown";
import { Sparkline } from "@/components/Sparkline";

const CHANNEL_LABELS: Record<string, string> = {
  ad_click: "Advert",
  outbound_click: "Website",
  phone_click: "Phone",
  email_click: "Email",
};

export const dynamic = "force-dynamic";
export const metadata = { title: "Your statistics" };

/**
 * The agreed stats panel (USE-CASES gap 6): kept chart names, honest numbers,
 * impressions + cumulative counts carry the headline. Region and company
 * attribution are parked for Phase 1 (GAPS B2.1/B2.2) — resolveIp() returns
 * null for both until GeoLite2/a company vendor is wired, so those columns
 * render "Not available yet" rather than fabricated or misleading values.
 */
export default async function MemberStatsPage() {
  const user = await requireMember();
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthAgo = new Date(now - 30 * 864e5).toISOString();
  const sixtyDaysAgo = new Date(now - 60 * 864e5).toISOString();
  const yearAgo = new Date(now - 365 * 864e5).toISOString();
  const yearAgoDay = yearAgo.slice(0, 10);

  const thirtyDaysAgo = new Date(now - 30 * 864e5).toISOString().slice(0, 10);

  const [pageViewsMonth, pageViewsPriorMonth, pageViewsYear, pageViewsTrend, myStories, storyViews, myAdverts, audit, consent] = await Promise.all([
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", monthAgo),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", sixtyDaysAgo).lt("occurred_at", monthAgo),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", yearAgo),
    db.from("rollups_daily").select("day, count").eq("kind", "member_page_view").eq("member_id", user.memberId).gte("day", yearAgoDay),
    db.from("stories").select("id", { count: "exact" }).eq("member_id", user.memberId).eq("status", "published"),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "story_view").eq("member_id", user.memberId),
    db.from("adverts").select("id").eq("member_id", user.memberId),
    db.from("engagement_audit").select("occurred_on, region, company, page, views").eq("member_id", user.memberId).order("occurred_on", { ascending: false }).limit(20),
    db.from("consent_stats").select("total_requests, consented_requests").gte("day", thirtyDaysAgo),
  ]);

  // A5.5: 12 calendar months of member_page_view, oldest to newest, missing months as 0.
  const monthTotals = new Map<string, number>();
  for (const r of pageViewsTrend.data ?? []) {
    const key = r.day.slice(0, 7);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + r.count);
  }
  const monthKeys = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const trendValues = monthKeys.map((k) => monthTotals.get(k) ?? 0);
  const priorMonthCount = pageViewsPriorMonth.count ?? 0;
  const deltaPct = priorMonthCount > 0 ? Math.round((((pageViewsMonth.count ?? 0) - priorMonthCount) / priorMonthCount) * 100) : null;

  // GAPS C6: record() drops every event without consent — impressions/clicks
  // are a real lower bound, not a full count. Site-wide rate, not per-member:
  // consent_stats has no member_id (it's a pageview-level counter, not an
  // attributed one), so this is the best available estimate of the gap.
  const consentTotals = (consent.data ?? []).reduce(
    (acc, r) => ({ total: acc.total + r.total_requests, consented: acc.consented + r.consented_requests }),
    { total: 0, consented: 0 },
  );
  const acceptRatePct = consentTotals.total > 0 ? Math.round((consentTotals.consented / consentTotals.total) * 100) : null;

  const advertIds = (myAdverts.data ?? []).map((a) => a.id);
  let impressions = 0, clicks = 0, newsletterClicks = 0;
  if (advertIds.length) {
    const [imp, clk, newsletterAdRows] = await Promise.all([
      db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_impression").in("advert_id", advertIds).gte("occurred_at", yearAgo),
      db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_click").in("advert_id", advertIds).gte("occurred_at", yearAgo),
      db.from("newsletter_ads").select("advert_id, issue:newsletter_issues!inner(status)").in("advert_id", advertIds).eq("issue.status", "sent"),
    ]);
    impressions = imp.count ?? 0;
    clicks = clk.count ?? 0;
    const newsletterAdvertIds = [...new Set((newsletterAdRows.data ?? []).map((r) => r.advert_id))];
    if (newsletterAdvertIds.length) {
      const { count } = await db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_click").in("advert_id", newsletterAdvertIds);
      newsletterClicks = count ?? 0;
    }
  }

  // A5.6/A5.10: outbound website clicks, folded additively into "Clicks overview"
  // so the number never drops vs the ad-click-only figure it replaces.
  const { count: outboundClickCount } = await db
    .from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "outbound_click").eq("member_id", user.memberId).gte("occurred_at", yearAgo);
  const clicksOverview = clicks + (outboundClickCount ?? 0);

  // A5.10: member-scoped clicks-by-channel breakdown (Gap 6 item 3 / item 5).
  const { data: channelRows } = await db
    .from("analytics_events")
    .select("kind, platform")
    .eq("member_id", user.memberId)
    .in("kind", ["ad_click", "outbound_click", "phone_click", "email_click", "social_click"])
    .gte("occurred_at", yearAgo);
  const channelCounts = new Map<string, number>();
  for (const r of channelRows ?? []) {
    const label = r.kind === "social_click" ? (r.platform ? `Social: ${r.platform}` : "Social") : (CHANNEL_LABELS[r.kind] ?? r.kind);
    channelCounts.set(label, (channelCounts.get(label) ?? 0) + 1);
  }

  // A5.7: newsletter value — issues that carried one of this member's stories,
  // filtered to actually-sent issues in the current calendar year (the old
  // query counted every newsletter_items row regardless of status or year).
  const storyIds = (myStories.data ?? []).map((s) => s.id);
  const yearStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1)).toISOString();
  let featuredIn = 0;
  if (storyIds.length) {
    const { count } = await db
      .from("newsletter_items")
      .select("issue:newsletter_issues!inner(status, sent_at)", { count: "exact", head: true })
      .in("story_id", storyIds)
      .eq("issue.status", "sent")
      .gte("issue.sent_at", yearStart);
    featuredIn = count ?? 0;
  }

  // A5.7: real reader figure — the most recent sent issue's actual recipient
  // count, replacing the hardcoded "~2,500" literal. Falls back to the
  // current subscribed-contacts count if no issue has ever sent yet.
  const { data: lastSentIssue } = await db
    .from("newsletter_issues").select("sent_count").eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  let readerEstimate = lastSentIssue?.sent_count ?? null;
  if (readerEstimate == null) {
    const { count } = await db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true).is("unsubscribed_at", null);
    readerEstimate = count ?? 0;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Your statistics</h1>
      <p className="mt-1 text-sm text-gray-500">Real, unpadded numbers, measured on SMI&apos;s own platform.</p>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Page performance"
          value={pageViewsMonth.count ?? 0}
          sub={`${pageViewsYear.count ?? 0} in 12 months${deltaPct != null ? ` · ${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs prior 30 days` : ""}`}
        >
          <Sparkline values={trendValues} />
        </Stat>
        <Stat label="Advert impressions" value={impressions} sub="pages your brand appeared on (12 mo)" />
        <Stat label="Clicks overview" value={clicksOverview} sub="advert + website clicks (12 mo)" />
        <Stat label="Story reach" value={storyViews.count ?? 0} sub={`${myStories.count ?? 0} stories, all-time views`} />
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Clicks by channel</h2>
        <p className="mt-1 text-xs text-gray-500">Last 12 months.</p>
        <div className="mt-3">
          <ChannelBreakdown rows={[...channelCounts.entries()].map(([label, count]) => ({ label, count }))} />
        </div>
      </section>
      {acceptRatePct !== null && (
        <p className="mt-2 text-xs text-gray-500">
          These counts only include visits where the reader accepted analytics cookies — about {acceptRatePct}% of
          site traffic in the last 30 days. Treat every number above as a floor, not a total.
        </p>
      )}

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Newsletter value</h2>
        <p className="mt-1 text-sm text-gray-600">
          Your stories featured in <b>{featuredIn}</b> newsletter issue{featuredIn === 1 ? "" : "s"} this year, reaching
          ~{readerEstimate.toLocaleString()} trade readers each.
          {newsletterClicks > 0 && <> Your newsletter adverts have been clicked <b>{newsletterClicks}</b> time{newsletterClicks === 1 ? "" : "s"}.</>}
        </p>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Who&apos;s engaging</h2>
        <p className="mt-1 text-xs text-gray-500">
          Company and region attribution isn&apos;t switched on yet — that layer is parked for a later phase, not a
          per-visit lookup that came back empty. The dates and view counts below are real.
        </p>
        <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-gray-500"><th scope="col" className="py-1">Date</th><th scope="col">Who</th><th scope="col">Where</th><th scope="col">Views</th></tr></thead>
          <tbody>
            {(audit.data ?? []).map((a, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5 text-gray-500">{a.occurred_on}</td>
                <td className="font-medium">{a.company ?? <span className="font-normal text-gray-500">Not available yet</span>}</td>
                <td>{a.region ?? <span className="text-gray-500">Not available yet</span>}</td>
                <td>{a.views}</td>
              </tr>
            ))}
            {(audit.data ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-gray-500">No engagement recorded yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, children }: { label: string; value: number; sub: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500">{sub}</p>
      {children}
    </div>
  );
}
