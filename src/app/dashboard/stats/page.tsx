import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { StackedTrendChart, type ChartSeries } from "@/components/StackedTrendChart";
import { TrendChart } from "@/components/Sparkline";

const CHANNEL_LABELS: Record<string, string> = {
  ad_click: "Advert",
  outbound_click: "Website",
  phone_click: "Phone",
  email_click: "Email",
};
const CLICK_KINDS = ["ad_click", "outbound_click", "phone_click", "email_click", "social_click"] as const;
const CLICK_CATEGORIES = ["Advert", "Website", "Phone", "Email", "Social"] as const;

export const dynamic = "force-dynamic";
export const metadata = { title: "Your statistics" };

/**
 * The agreed stats panel (USE-CASES gap 6): kept chart names, honest numbers,
 * impressions + cumulative counts carry the headline. Region and company
 * attribution are parked for Phase 1 (GAPS B2.1/B2.2) — resolveIp() returns
 * null for both until GeoLite2/a company vendor is wired, so "Who's engaging"
 * and company/region columns stay out of this page for now rather than
 * showing "Not available yet" everywhere.
 */
export default async function MemberStatsPage() {
  const user = await requireMember();
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- per-request render
  const now = Date.now();
  const monthAgo = new Date(now - 30 * 864e5).toISOString();
  const yearAgo = new Date(now - 365 * 864e5).toISOString();
  const yearAgoDay = yearAgo.slice(0, 10);
  const thirtyDaysAgo = new Date(now - 30 * 864e5).toISOString().slice(0, 10);

  const [pageViewsMonth, pageViewsTrend, myStories, storyViews, myAdverts, consent] = await Promise.all([
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", monthAgo),
    db.from("rollups_daily").select("day, count").eq("kind", "member_page_view").eq("member_id", user.memberId).gte("day", yearAgoDay),
    db.from("stories").select("id").eq("member_id", user.memberId).eq("status", "published"),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "story_view").eq("member_id", user.memberId).gte("occurred_at", monthAgo),
    db.from("adverts").select("id").eq("member_id", user.memberId),
    db.from("consent_stats").select("total_requests, consented_requests").gte("day", thirtyDaysAgo),
  ]);

  const storyIds = (myStories.data ?? []).map((s) => s.id);
  const advertIds = (myAdverts.data ?? []).map((a) => a.id);

  type ImpressionRow = { occurred_at: string; path: string | null };
  type NewsletterAdRow = { advert_id: string; issue: { id: string; sent_at: string | null; opens_count: number } | null };

  const [storyViewsTrend, clickEvents, [impressionRows, newsletterOpenRows]] = await Promise.all([
    storyIds.length
      ? db.from("rollups_daily").select("day, count").eq("kind", "story_view").in("story_id", storyIds).gte("day", yearAgoDay)
      : Promise.resolve({ data: [] as { day: string; count: number }[] }),
    db.from("analytics_events").select("occurred_at, kind").eq("member_id", user.memberId).in("kind", CLICK_KINDS).gte("occurred_at", yearAgo),
    advertIds.length
      ? Promise.all([
          db.from("analytics_events").select("occurred_at, path").eq("kind", "ad_impression").in("advert_id", advertIds).gte("occurred_at", yearAgo),
          db.from("newsletter_ads").select("advert_id, issue:newsletter_issues!inner(id, sent_at, opens_count, status)").in("advert_id", advertIds).eq("issue.status", "sent").gte("issue.sent_at", yearAgo),
        ])
      : (Promise.resolve([{ data: [] }, { data: [] }]) as Promise<[{ data: ImpressionRow[] }, { data: NewsletterAdRow[] }]>),
  ]);

  const monthKeys = monthKeysFor(now);
  // page performance / story reach: rollups_daily is already pre-aggregated per
  // day, so these are a straight month-bucket reshape — no new instrumentation.
  const trendValues = bucketSingleSeries(pageViewsTrend.data ?? [], monthKeys);
  const storyReachValues = bucketSingleSeries(storyViewsTrend.data ?? [], monthKeys);

  // GAPS C6: record() drops every event without consent — impressions/clicks
  // are a real lower bound, not a full count. Site-wide rate, not per-member:
  // consent_stats has no member_id (it's a pageview-level counter, not an
  // attributed one), so this is the best available estimate of the gap.
  const consentTotals = (consent.data ?? []).reduce(
    (acc, r) => ({ total: acc.total + r.total_requests, consented: acc.consented + r.consented_requests }),
    { total: 0, consented: 0 },
  );
  const acceptRatePct = consentTotals.total > 0 ? Math.round((consentTotals.consented / consentTotals.total) * 100) : null;

  // Last 30 days tiles: bare totals, filtered client-side from the same rows
  // the month-by-month charts already fetched, rather than separate queries.
  const impressions30 = (impressionRows.data ?? []).filter((r) => r.occurred_at >= monthAgo).length;
  // Deliberately narrower than the 5-channel month-by-month chart below it —
  // matches this tile's original definition (advert + website clicks only).
  const clicksOverview30 = (clickEvents.data ?? []).filter(
    (r) => r.occurred_at >= monthAgo && (r.kind === "ad_click" || r.kind === "outbound_click"),
  ).length;

  // Month-by-month: clicks by channel, all social platforms folded into one
  // "Social" series — per-platform detail stays only on console/analytics.
  const clicksSeries = bucketMultiSeries(
    clickEvents.data ?? [],
    (r) => r.occurred_at.slice(0, 7),
    (r) => (r.kind === "social_click" ? "Social" : (CHANNEL_LABELS[r.kind] ?? r.kind)),
    CLICK_CATEGORIES,
    monthKeys,
  );

  // Month-by-month: advert impressions by location. Real path data only
  // exists for events recorded after this instrumentation shipped — older
  // months read honestly sparse/zero, not backfilled.
  const impressionsBase = bucketMultiSeries(
    impressionRows.data ?? [],
    (r) => r.occurred_at.slice(0, 7),
    (r) => (r.path === "/" ? "Homepage" : r.path?.startsWith("/") ? "Other pages" : null),
    ["Homepage", "Other pages"],
    monthKeys,
  );
  // Newsletter series is issue-level, not per-advert — newsletter_ads has no
  // metrics of its own, so this attributes each sent issue's real,
  // webhook-driven opens_count to the member for the month it sent, for every
  // issue that carried one of their adverts (see docs/GAPS.md A5.4/A5.5).
  const seenIssues = new Map<string, { sent_at: string | null; opens_count: number }>();
  for (const row of newsletterOpenRows.data ?? []) {
    if (row.issue && !seenIssues.has(row.issue.id)) seenIssues.set(row.issue.id, row.issue);
  }
  const newsletterOpensByMonth = new Map<string, number>();
  for (const { sent_at, opens_count } of seenIssues.values()) {
    if (!sent_at) continue;
    const key = sent_at.slice(0, 7);
    newsletterOpensByMonth.set(key, (newsletterOpensByMonth.get(key) ?? 0) + opens_count);
  }
  const impressionsSeries: ChartSeries[] = [
    ...impressionsBase,
    { label: "Newsletter", values: monthKeys.map((m) => newsletterOpensByMonth.get(m) ?? 0) },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Your statistics</h1>
      <p className="mt-1 text-sm text-graphite">Real, unpadded numbers, measured on SMI&apos;s own platform.</p>

      <h2 className="mt-6 font-bold text-ink">Last 30 days</h2>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Page views" value={pageViewsMonth.count ?? 0} />
        <Stat label="Advert impressions" value={impressions30} />
        <Stat label="Clicks overview" value={clicksOverview30} />
        <Stat label="Story views" value={storyViews.count ?? 0} />
      </div>

      <h2 className="mt-8 font-bold text-ink">Month by month</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink">Page performance</h3>
          <div className="mt-3"><TrendChart values={trendValues} labels={monthKeys} /></div>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink">Story reach</h3>
          <div className="mt-3"><TrendChart values={storyReachValues} labels={monthKeys} /></div>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink">Advert impressions</h3>
          <p className="mt-1 text-xs text-graphite">Where your advert appeared.</p>
          <div className="mt-3"><StackedTrendChart labels={monthKeys} series={impressionsSeries} /></div>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink">Clicks overview</h3>
          <p className="mt-1 text-xs text-graphite">By channel — wider than the 30-day figure above, which counts advert and website clicks only.</p>
          <div className="mt-3"><StackedTrendChart labels={monthKeys} series={clicksSeries} /></div>
        </section>
      </div>

      {acceptRatePct !== null && (
        <p className="mt-6 text-xs text-graphite">
          These counts only include visits where the reader accepted analytics cookies — about {acceptRatePct}% of
          site traffic in the last 30 days. Treat every number above as a floor, not a total.
        </p>
      )}
    </div>
  );
}

function monthKeysFor(now: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function bucketSingleSeries(rows: { day: string; count: number }[], monthKeys: string[]): number[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = r.day.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + r.count);
  }
  return monthKeys.map((k) => totals.get(k) ?? 0);
}

function bucketMultiSeries<T>(
  rows: T[],
  monthOf: (r: T) => string,
  categoryOf: (r: T) => string | null,
  categories: readonly string[],
  monthKeys: string[],
): ChartSeries[] {
  const totals = new Map<string, number>(); // `${month}|${category}` -> count
  for (const r of rows) {
    const cat = categoryOf(r);
    if (cat == null) continue;
    const key = `${monthOf(r)}|${cat}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return categories.map((label) => ({ label, values: monthKeys.map((m) => totals.get(`${m}|${label}`) ?? 0) }));
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-graphite">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value.toLocaleString()}</p>
    </div>
  );
}
