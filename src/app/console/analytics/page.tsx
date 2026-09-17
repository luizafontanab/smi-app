import { requireConsole } from "@/lib/auth";
import { classifyReferrer } from "@/lib/analytics";
import { serviceDb } from "@/lib/db/server";
import { Card, SectionTitle, Stat } from "@/components/console/ui";
import { ChannelBreakdown } from "@/components/ChannelBreakdown";
import { TrendChart } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;
const TRAFFIC_KINDS = ["page_view", "story_view", "member_page_view"];
const CHANNEL_KINDS = ["outbound_click", "phone_click", "email_click", "social_click"];
const CHANNEL_LABELS: Record<string, string> = {
  outbound_click: "Website",
  phone_click: "Phone",
  email_click: "Email",
};
// A cap on the raw-event reads below (referrer mix, clicks by channel) — this
// page reads a bounded recent sample rather than the full window, so numbers
// here are directional, not exhaustive; rollups_daily-backed sections (traffic,
// most-read) are exact since they're already pre-aggregated.
const RAW_EVENT_SAMPLE = 5000;

export default async function AnalyticsPage() {
  await requireConsole();
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
  const sinceDay = since.slice(0, 10);

  const [traffic, storyViews, referrerRows, channelRows, searchRows] = await Promise.all([
    db.from("rollups_daily").select("day, count").in("kind", TRAFFIC_KINDS).gte("day", sinceDay),
    db.from("rollups_daily").select("story_id, count").eq("kind", "story_view").gte("day", sinceDay).not("story_id", "is", null),
    db.from("analytics_events").select("referrer").in("kind", TRAFFIC_KINDS).gte("occurred_at", since).limit(RAW_EVENT_SAMPLE),
    db.from("analytics_events").select("kind, platform").in("kind", CHANNEL_KINDS).gte("occurred_at", since).limit(RAW_EVENT_SAMPLE),
    db.from("search_queries").select("query, results_count, occurred_at").gte("occurred_at", since).limit(RAW_EVENT_SAMPLE),
  ]);

  // Traffic trend: one row per day already (page_view/story_view/member_page_view
  // rows in rollups_daily carry no story/member dimension of their own for the
  // site-wide total, but summing defensively here costs nothing).
  const byDay = new Map<string, number>();
  for (const r of traffic.data ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.count);
  const days = [...byDay.keys()].sort();
  const trendValues = days.map((d) => byDay.get(d)!);
  const totalTraffic = trendValues.reduce((a, b) => a + b, 0);

  // Most-read stories: sum across days per story, then look up titles.
  const byStory = new Map<string, number>();
  for (const r of storyViews.data ?? []) {
    if (!r.story_id) continue;
    byStory.set(r.story_id, (byStory.get(r.story_id) ?? 0) + r.count);
  }
  const topStoryIds = [...byStory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const { data: topStories } = topStoryIds.length
    ? await db.from("stories").select("id, title, slug").in("id", topStoryIds)
    : { data: [] as { id: string; title: string; slug: string }[] };
  const storyById = new Map((topStories ?? []).map((s) => [s.id, s] as const));

  // Referrer mix, incl. AI classification — needs the raw referrer string, which
  // rollups_daily doesn't carry.
  const referrerCounts = new Map<string, number>();
  for (const r of referrerRows.data ?? []) {
    const bucket = classifyReferrer(r.referrer);
    referrerCounts.set(bucket, (referrerCounts.get(bucket) ?? 0) + 1);
  }
  const referrerLabels: Record<string, string> = { direct: "Direct", search: "Search", social: "Social", ai: "AI assistants", other: "Other" };

  // Clicks by channel, site-wide.
  const channelCounts = new Map<string, number>();
  for (const r of channelRows.data ?? []) {
    const label = r.kind === "social_click" ? (r.platform ? `Social: ${r.platform}` : "Social") : (CHANNEL_LABELS[r.kind] ?? r.kind);
    channelCounts.set(label, (channelCounts.get(label) ?? 0) + 1);
  }

  // Search report (A5.2 / A27).
  const queries = searchRows.data ?? [];
  const queryCounts = new Map<string, number>();
  for (const q of queries) {
    const key = q.query.trim().toLowerCase();
    if (key) queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
  }
  const topQueries = [...queryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const zeroResult = queries
    .filter((q) => q.results_count === 0)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-ink">Analytics</h1>
      <p className="text-sm text-graphite">
        Last {WINDOW_DAYS} days. Traffic and most-read figures come from the nightly rollup; referrer mix, clicks-by-channel
        and search are read from a recent sample of raw events, so they&apos;re directional rather than exhaustive.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Page views" value={String(totalTraffic)} sub={`Last ${WINDOW_DAYS} days`} />
        <Stat label="Searches" value={String(queries.length)} sub={`Last ${WINDOW_DAYS} days (sampled)`} />
        <Stat label="Zero-result searches" value={String(queries.filter((q) => q.results_count === 0).length)} sub="Sampled" />
      </div>

      <Card>
        <SectionTitle>Traffic trend</SectionTitle>
        <div className="mt-3">
          <TrendChart values={trendValues} labels={days} />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>Most-read stories</SectionTitle>
          <ol className="mt-3 space-y-1.5 text-sm">
            {[...byStory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => {
              const story = storyById.get(id);
              return (
                <li key={id} className="flex justify-between gap-3 border-t pt-1.5">
                  <span className="truncate">{story?.title ?? "Untitled"}</span>
                  <span className="shrink-0 font-semibold text-ink">{count}</span>
                </li>
              );
            })}
            {byStory.size === 0 && <p className="text-sm text-graphite">No story views yet.</p>}
          </ol>
        </Card>

        <Card>
          <SectionTitle>Referrer mix</SectionTitle>
          <div className="mt-3">
            <ChannelBreakdown
              rows={[...referrerCounts.entries()].map(([key, count]) => ({ label: referrerLabels[key] ?? key, count }))}
            />
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle>Clicks by channel</SectionTitle>
        <div className="mt-3">
          <ChannelBreakdown rows={[...channelCounts.entries()].map(([label, count]) => ({ label, count }))} />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>Top searches</SectionTitle>
          <ol className="mt-3 space-y-1.5 text-sm">
            {topQueries.map(([query, count]) => (
              <li key={query} className="flex justify-between gap-3 border-t pt-1.5">
                <span className="truncate">{query}</span>
                <span className="shrink-0 font-semibold text-ink">{count}</span>
              </li>
            ))}
            {topQueries.length === 0 && <p className="text-sm text-graphite">No searches yet.</p>}
          </ol>
        </Card>

        <Card>
          <SectionTitle>Zero-result searches</SectionTitle>
          <ul className="mt-3 space-y-1.5 text-sm">
            {zeroResult.map((q, i) => (
              <li key={i} className="flex justify-between gap-3 border-t pt-1.5">
                <span className="truncate">{q.query}</span>
                <span className="shrink-0 text-xs text-graphite">{q.occurred_at.slice(0, 10)}</span>
              </li>
            ))}
            {zeroResult.length === 0 && <p className="text-sm text-graphite">None in this window.</p>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
