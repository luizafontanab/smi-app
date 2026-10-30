import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { requireConsole } from "@/lib/auth";
import { classifyReferrer } from "@/lib/analytics";
import {
  addDays,
  indexBy,
  londonToday,
  paginate,
  parseRange,
  pctChange,
  PRESETS,
  previousRange,
  sessionsPerUser,
  sqlBounds,
  toSiteStats,
  type DayRange,
} from "@/lib/analytics-report";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { siteUrl } from "@/lib/site-url";
import { Card, SectionTitle } from "@/components/console/ui";
import { ChannelBreakdown } from "@/components/ChannelBreakdown";
import { TrendChart } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

const CHANNEL_KINDS = ["outbound_click", "phone_click", "email_click", "social_click"];
const CHANNEL_LABELS: Record<string, string> = {
  outbound_click: "Website",
  phone_click: "Phone",
  email_click: "Email",
};
// Clicks and searches are still read from raw rows, capped. The headline
// figures, pages, sources, devices and countries come from site_stats(),
// which is exact.
const RAW_EVENT_SAMPLE = 5000;
// Device and country started being recorded with migration 20261029000001.
const DEVICE_COUNTRY_SINCE = "29 Oct 2026";
const BUCKET_LABELS: Record<string, string> = { direct: "Direct", search: "Search", social: "Social", ai: "AI assistants", other: "Other" };

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtRange = (r: DayRange) => `${fmtDay(r.from)} – ${fmtDay(r.to)}`;
const fmtInt = (n: number) => n.toLocaleString("en-GB");

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  if (code === "unknown") return "Unknown";
  try {
    regionNames ??= new Intl.DisplayNames(["en-GB"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** ▲ 12.5% / ▼ 4.0% against the previous period; "–" when there is nothing to compare with. */
function Delta({ current, previous }: { current: number; previous: number }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span className="text-graphite">–</span>;
  const up = pct >= 0;
  return (
    <span className={`tabular-nums ${up ? "text-success" : "text-danger"}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span> {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, current, previous }: { label: string; value: string; current: number; previous: number }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-graphite">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</p>
      <p className="text-xs">
        <Delta current={current} previous={previous} />
      </p>
    </div>
  );
}

/** A ranked table in the shape of Jas's Data Studio report: label, count, % Δ. */
function RankTable({
  label,
  countLabel,
  rows,
  startAt = 1,
  footer,
}: {
  label: string;
  countLabel: string;
  rows: { key: string; cell: ReactNode; count: number; previous: number }[];
  startAt?: number;
  footer?: ReactNode;
}) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-graphite">Nothing recorded in this period.</p>;
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-graphite">
          <th className="w-8 py-1.5 font-medium">#</th>
          <th className="py-1.5 font-medium">{label}</th>
          <th className="py-1.5 text-right font-medium">{countLabel}</th>
          <th className="w-20 py-1.5 text-right font-medium">% Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className="border-b border-line/60">
            <td className="py-1.5 text-graphite tabular-nums">{startAt + i}.</td>
            <td className="max-w-0 truncate py-1.5 pr-3">{r.cell}</td>
            <td className="py-1.5 text-right font-semibold text-ink tabular-nums">{fmtInt(r.count)}</td>
            <td className="py-1.5 text-right text-xs">
              <Delta current={r.count} previous={r.previous} />
            </td>
          </tr>
        ))}
      </tbody>
      {footer}
    </table>
  );
}

export default async function AnalyticsPage(props: PageProps<"/console/analytics">) {
  await requireConsole();
  const sp = await props.searchParams;
  const range = parseRange(sp, londonToday());
  const prev = previousRange(range);
  const site = siteUrl();
  // A referrer from the site itself counts as direct. The request's own host is
  // the reliable name for "the site" (preview deploys and local dev differ from
  // siteUrl()); referrer hosts carry no port, so neither does this.
  const siteHost = ((await headers()).get("host") ?? new URL(site).host).split(":")[0];
  const db = serviceDb();
  const { p_from, p_to } = sqlBounds(range);

  const [curJson, prevJson, consentRows, channelRows, searchRows] = await Promise.all([
    must(db.rpc("site_stats", { ...sqlBounds(range), p_site_host: siteHost }), "console/analytics site_stats"),
    must(db.rpc("site_stats", { ...sqlBounds(prev), p_site_host: siteHost }), "console/analytics site_stats previous"),
    must(db.from("consent_stats").select("total_requests, consented_requests").gte("day", range.from).lte("day", range.to), "console/analytics consent"),
    must(db.from("analytics_events").select("kind, platform").in("kind", CHANNEL_KINDS).gte("occurred_at", p_from).lt("occurred_at", p_to).limit(RAW_EVENT_SAMPLE), "console/analytics channels"),
    must(db.from("search_queries").select("query, results_count, occurred_at").gte("occurred_at", p_from).lt("occurred_at", p_to).limit(RAW_EVENT_SAMPLE), "console/analytics searches"),
  ]);
  const cur = toSiteStats(curJson);
  const before = toSiteStats(prevJson);

  // Trend: one point per day in the range, zero-filled.
  const viewsByDay = indexBy(cur.daily, (d) => d.day, (d) => d.views);
  const trendDays = Array.from({ length: range.days }, (_, i) => addDays(range.from, i));
  const trendValues = trendDays.map((d) => viewsByDay.get(d) ?? 0);

  // Top pages, paged 10 at a time like the Data Studio table.
  const prevPages = indexBy(before.top_pages, (p) => p.path, (p) => p.views);
  const pages = paginate(cur.top_pages, sp.page);
  const pageHref = (n: number) => `?${new URLSearchParams({ from: range.from, to: range.to, page: String(n) })}`;

  const prevSources = indexBy(before.sources, (s) => s.source, (s) => s.users);
  const prevDevices = indexBy(before.devices, (d) => d.device, (d) => d.users);
  const prevCountries = indexBy(before.countries, (c) => c.country, (c) => c.users);

  // The Direct / Search / Social / AI summary, now from exact per-user sources.
  const buckets = new Map<string, number>();
  for (const s of cur.sources) {
    const bucket = s.source === "(direct)" ? "direct" : classifyReferrer(`https://${s.source}/`);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + s.users);
  }

  const consent = (consentRows ?? []).reduce(
    (acc, r) => ({ total: acc.total + r.total_requests, consented: acc.consented + r.consented_requests }),
    { total: 0, consented: 0 },
  );
  const consentPct = consent.total ? Math.round((consent.consented / consent.total) * 100) : null;

  const channelCounts = new Map<string, number>();
  for (const r of channelRows ?? []) {
    const label = r.kind === "social_click" ? (r.platform ? `Social: ${r.platform}` : "Social") : (CHANNEL_LABELS[r.kind] ?? r.kind);
    channelCounts.set(label, (channelCounts.get(label) ?? 0) + 1);
  }

  const queries = searchRows ?? [];
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Website statistics</h1>
          <p className="text-sm text-graphite">
            {fmtRange(range)} · compared with {fmtRange(prev)}
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col text-xs text-graphite">
            From
            <input type="date" name="from" defaultValue={range.from} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
          </label>
          <label className="flex flex-col text-xs text-graphite">
            To
            <input type="date" name="to" defaultValue={range.to} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
          </label>
          <button type="submit" className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </div>
      <nav aria-label="Quick ranges" className="flex gap-2 text-sm">
        {PRESETS.map((d) => (
          <Link
            key={d}
            href={`?days=${d}`}
            aria-current={Number(sp.days) === d ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${Number(sp.days) === d ? "border-ink bg-ink text-white" : "border-line text-graphite hover:text-ink"}`}
          >
            Last {d} days
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Kpi label="Total users" value={fmtInt(cur.users)} current={cur.users} previous={before.users} />
        <Kpi label="New users" value={fmtInt(cur.new_users)} current={cur.new_users} previous={before.new_users} />
        <Kpi label="Views" value={fmtInt(cur.views)} current={cur.views} previous={before.views} />
        <Kpi label="Sessions per user" value={sessionsPerUser(cur).toFixed(1)} current={sessionsPerUser(cur)} previous={sessionsPerUser(before)} />
      </div>

      <Card>
        <SectionTitle>Views per day</SectionTitle>
        <div className="mt-3">
          <TrendChart values={trendValues} labels={trendDays} />
        </div>
      </Card>

      <Card>
        <SectionTitle>Top pages</SectionTitle>
        <RankTable
          label="Page"
          countLabel="Views"
          startAt={pages.start}
          rows={pages.rows.map((p) => ({
            key: p.path,
            cell: (
              <a href={`${site}${p.path}`} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-brand-text">
                {p.path}
              </a>
            ),
            count: p.views,
            previous: prevPages.get(p.path) ?? 0,
          }))}
          footer={
            <tfoot>
              <tr className="font-semibold text-ink">
                <td />
                <td className="py-1.5">Grand total</td>
                <td className="py-1.5 text-right tabular-nums">{fmtInt(cur.views)}</td>
                <td className="py-1.5 text-right text-xs">
                  <Delta current={cur.views} previous={before.views} />
                </td>
              </tr>
            </tfoot>
          }
        />
        {pages.total > 0 && (
          <div className="mt-2 flex items-center justify-end gap-3 text-sm text-graphite">
            <span className="tabular-nums">
              {pages.start}–{pages.end} / {pages.total}
            </span>
            {pages.page > 1 ? <Link href={pageHref(pages.page - 1)} aria-label="Previous page">‹</Link> : <span aria-hidden className="opacity-30">‹</span>}
            {pages.page < pages.pages ? <Link href={pageHref(pages.page + 1)} aria-label="Next page">›</Link> : <span aria-hidden className="opacity-30">›</span>}
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>User source</SectionTitle>
          <RankTable
            label="Source"
            countLabel="Users"
            rows={cur.sources.slice(0, 10).map((s) => ({ key: s.source, cell: s.source, count: s.users, previous: prevSources.get(s.source) ?? 0 }))}
          />
          <div className="mt-4">
            <ChannelBreakdown rows={[...buckets.entries()].map(([key, count]) => ({ label: BUCKET_LABELS[key] ?? key, count }))} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle>Device category</SectionTitle>
            <RankTable
              label="Device"
              countLabel="Users"
              rows={cur.devices.map((d) => ({ key: d.device, cell: d.device === "unknown" ? "Unknown" : d.device, count: d.users, previous: prevDevices.get(d.device) ?? 0 }))}
            />
            <p className="mt-2 text-xs text-graphite">Recorded from {DEVICE_COUNTRY_SINCE}; earlier visits show as Unknown.</p>
          </Card>
          <Card>
            <SectionTitle>Top countries</SectionTitle>
            <RankTable
              label="Country"
              countLabel="Users"
              rows={cur.countries.slice(0, 10).map((c) => ({ key: c.country, cell: countryName(c.country), count: c.users, previous: prevCountries.get(c.country) ?? 0 }))}
            />
            <p className="mt-2 text-xs text-graphite">Recorded from {DEVICE_COUNTRY_SINCE}; earlier visits show as Unknown.</p>
          </Card>
        </div>
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

      <p className="text-xs text-graphite">
        Counts only visitors who accepted analytics cookies, and leaves out known bots, so totals will be lower than Google
        Analytics showed{consentPct !== null && <> ({consentPct}% of visits in this period accepted)</>}. A user is one browser
        on one connection, so someone on a phone and a laptop counts twice. A session ends after 30 minutes without a page view.
        Clicks and searches are read from up to {fmtInt(RAW_EVENT_SAMPLE)} recent rows.
      </p>
    </div>
  );
}
