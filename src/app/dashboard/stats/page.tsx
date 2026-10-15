import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { StackedTrendChart, type ChartSeries } from "@/components/StackedTrendChart";
import { TrendChart } from "@/components/Sparkline";
import { contentReach, sumSeries, VIDEO_VIEWS_SINCE } from "@/lib/content-reach";
import { allRows } from "@/lib/db/all-rows";

const CHANNEL_LABELS: Record<string, string> = {
  ad_click: "Advert",
  outbound_click: "Website",
  phone_click: "Phone",
  email_click: "Email",
};
const CLICK_KINDS = ["ad_click", "outbound_click", "phone_click", "email_click", "social_click"] as const;
const CLICK_CATEGORIES = ["Advert", "Website", "Phone", "Email", "Social"] as const;

/** From this day advert impressions include readers who declined cookies (GAPS D1). */
const IMPRESSIONS_COMPLETE_SINCE = "28 September 2026";

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

  const [pageViewsMonth, pageViewsTrend, myStories, myAdverts, consent] = await Promise.all([
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "member_page_view").eq("member_id", user.memberId).gte("occurred_at", monthAgo),
    db.from("rollups_daily").select("day, count").eq("kind", "member_page_view").eq("member_id", user.memberId).gte("day", yearAgoDay),
    // Every published story featuring this member — primary or tagged alongside
    // others (Jas 13/10 item 12). story_members holds the primary too.
    db.from("stories").select("id, story_members!inner(member_id)").eq("story_members.member_id", user.memberId).eq("status", "published"),
    db.from("adverts").select("id").eq("member_id", user.memberId),
    db.from("consent_stats").select("total_requests, consented_requests").gte("day", thirtyDaysAgo),
  ]);

  const storyIds = (myStories.data ?? []).map((s) => s.id);
  const advertIds = (myAdverts.data ?? []).map((a) => a.id);

  type NewsletterAdRow = { advert_id: string; issue: { id: string; sent_at: string | null; opens_count: number } | null };

  // Content reach (GAPS A9.2): all-time totals, counted exactly (head counts,
  // so no max_rows truncation) — the cumulative figure Gap 6 says can only grow.
  // Story views are counted by story, not by analytics_events.member_id: that
  // column is stamped with the primary member at view time, so it never saw a
  // co-featured member. Counting by the stories a member is tagged in credits
  // every member a story features — including views from before they were
  // tagged, and following any later change of tags.
  const storyViewCount = (since?: string) => {
    if (!storyIds.length) return Promise.resolve({ count: 0 });
    const q = db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "story_view").in("story_id", storyIds);
    return since ? q.gte("occurred_at", since) : q;
  };
  const [allTimeImpressions, allTimeStoryViews, storyViews, allTimeVideoViews, allTimeNewsletterRows, videoViewsTrend] = await Promise.all([
    advertIds.length
      ? db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_impression").in("advert_id", advertIds)
      : Promise.resolve({ count: 0 }),
    storyViewCount(),
    storyViewCount(monthAgo),
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "video_view").eq("member_id", user.memberId),
    advertIds.length
      ? db.from("newsletter_ads").select("advert_id, issue:newsletter_issues!inner(id, opens_count, status)").in("advert_id", advertIds).eq("issue.status", "sent")
      : Promise.resolve({ data: [] as { issue: { id: string; opens_count: number } | null }[] }),
    db.from("rollups_daily").select("day, count").eq("kind", "video_view").eq("member_id", user.memberId).gte("day", yearAgoDay),
  ]);

  // Counted in the database, not by fetching rows: PostgREST caps a response at
  // max_rows (1000), so a year of a busy advertiser's raw impression and click
  // rows used to be silently truncated and the charts under-counted
  // (20260928000004_member_event_months.sql).
  const [storyViewsTrend, eventMonths, impressions30Count, clicks30Count, newsletterOpenRows] = await Promise.all([
    // One rollups row per story per day — ~3,650 a year for ten stories — so paged.
    storyIds.length
      ? allRows<{ day: string; count: number }>((from, to) =>
          db.from("rollups_daily").select("day, count").eq("kind", "story_view").in("story_id", storyIds).gte("day", yearAgoDay)
            .order("day").order("story_id").range(from, to))
      : Promise.resolve([] as { day: string; count: number }[]),
    db.rpc("member_event_months", { p_member: user.memberId, p_since: yearAgo }),
    advertIds.length
      ? db.from("analytics_events").select("*", { count: "exact", head: true }).eq("kind", "ad_impression").in("advert_id", advertIds).gte("occurred_at", monthAgo)
      : Promise.resolve({ count: 0 }),
    // Deliberately narrower than the 5-channel month-by-month chart below it —
    // this tile's original definition is advert + website clicks only.
    db.from("analytics_events").select("*", { count: "exact", head: true }).eq("member_id", user.memberId).in("kind", ["ad_click", "outbound_click"]).gte("occurred_at", monthAgo),
    advertIds.length
      ? db.from("newsletter_ads").select("advert_id, issue:newsletter_issues!inner(id, sent_at, opens_count, status)").in("advert_id", advertIds).eq("issue.status", "sent").gte("issue.sent_at", yearAgo)
      : Promise.resolve({ data: [] as NewsletterAdRow[] }),
  ]);
  const monthRows = eventMonths.data ?? [];

  const monthKeys = monthKeysFor(now);
  // page performance / story reach: rollups_daily is already pre-aggregated per
  // day, so these are a straight month-bucket reshape — no new instrumentation.
  const trendValues = bucketSingleSeries(pageViewsTrend.data ?? [], monthKeys);
  const storyReachValues = bucketSingleSeries(storyViewsTrend, monthKeys);

  // GAPS C6: record() drops every event without consent — impressions/clicks
  // are a real lower bound, not a full count. Site-wide rate, not per-member:
  // consent_stats has no member_id (it's a pageview-level counter, not an
  // attributed one), so this is the best available estimate of the gap.
  const consentTotals = (consent.data ?? []).reduce(
    (acc, r) => ({ total: acc.total + r.total_requests, consented: acc.consented + r.consented_requests }),
    { total: 0, consented: 0 },
  );
  const acceptRatePct = consentTotals.total > 0 ? Math.round((consentTotals.consented / consentTotals.total) * 100) : null;

  // Last 30 days tiles: exact head counts.
  const impressions30 = impressions30Count.count ?? 0;
  const clicksOverview30 = clicks30Count.count ?? 0;

  // Month-by-month: clicks by channel, all social platforms folded into one
  // "Social" series — per-platform detail stays only on console/analytics.
  const clicksSeries = bucketMultiSeries(
    monthRows.filter((r) => (CLICK_KINDS as readonly string[]).includes(r.kind)),
    (r) => r.month,
    (r) => (r.kind === "social_click" ? "Social" : (CHANNEL_LABELS[r.kind] ?? r.kind)),
    CLICK_CATEGORIES,
    monthKeys,
    (r) => Number(r.n),
  );

  // Month-by-month: advert impressions by location. Real path data only
  // exists for events recorded after this instrumentation shipped — older
  // months read honestly sparse/zero, not backfilled.
  // Location buckets (Homepage / Other pages) are assigned by the SQL function.
  const impressionsBase = bucketMultiSeries(
    monthRows.filter((r) => r.kind === "ad_impression"),
    (r) => r.month,
    (r) => r.bucket,
    ["Homepage", "Other pages"],
    monthKeys,
    (r) => Number(r.n),
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

  // Content reach: adverts count what the Advert impressions chart counts
  // (page impressions + newsletter opens), so the two charts agree.
  const allTimeNewsletterOpens = [
    ...new Map((allTimeNewsletterRows.data ?? []).flatMap((r) => (r.issue ? [[r.issue.id, r.issue.opens_count] as const] : []))).values(),
  ].reduce((sum, n) => sum + n, 0);
  const reach = contentReach([
    { label: "Adverts", total: (allTimeImpressions.count ?? 0) + allTimeNewsletterOpens },
    { label: "Stories", total: allTimeStoryViews.count ?? 0 },
    { label: "Videos", total: allTimeVideoViews.count ?? 0 },
  ]);
  const reachSeries: ChartSeries[] = [
    { label: "Adverts", values: sumSeries(impressionsSeries) },
    { label: "Stories", values: storyReachValues },
    { label: "Videos", values: bucketSingleSeries(videoViewsTrend.data ?? [], monthKeys) },
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
        {/* Was "Story reach" — the 18 Sep direction (Gap 6) combines every kind
            of content into one figure, broken out by type (GAPS A9.2). */}
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink">Content reach</h3>
          <p className="mt-1 text-2xl font-bold text-ink">{reach.total.toLocaleString("en-GB")}</p>
          <p className="text-xs text-graphite">
            All time · {reach.parts.map((p) => `${p.label} ${p.total.toLocaleString("en-GB")}`).join(" · ")}
          </p>
          <div className="mt-3"><StackedTrendChart labels={monthKeys} series={reachSeries} /></div>
          <p className="mt-2 text-xs text-graphite">
            Video views count from {VIDEO_VIEWS_SINCE}. Social shares will join this once we can measure them.
          </p>
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
          {/* Decision D1 (28 Sep): impressions are counted for every reader. */}
          Advert impressions count every reader who saw your advert since {IMPRESSIONS_COMPLETE_SINCE} — anonymously
          when they declined cookies. Everything else here (page, story and video views, and clicks) only includes
          visits where the reader accepted analytics cookies — about {acceptRatePct}% of site traffic in the last 30
          days — so treat those as a floor, not a total.
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
  // How much each row counts for: 1 for a raw event, `n` for a pre-counted row.
  weightOf: (r: T) => number = () => 1,
): ChartSeries[] {
  const totals = new Map<string, number>(); // `${month}|${category}` -> count
  for (const r of rows) {
    const cat = categoryOf(r);
    if (cat == null) continue;
    const key = `${monthOf(r)}|${cat}`;
    totals.set(key, (totals.get(key) ?? 0) + weightOf(r));
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
