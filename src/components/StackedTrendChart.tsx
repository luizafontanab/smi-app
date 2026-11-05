/**
 * Multi-series monthly stacked-bar chart — the categorical counterpart to
 * Sparkline.tsx's single-series shapes, for the two Month-by-month boxes that
 * need a breakdown (advert impressions by location, clicks by channel) rather
 * than a single trend line. Hand-rolled like TrendChart (HTML boxes rather
 * than SVG since #33), no hover/tooltip layer (TrendChart's own "deliberately kept
 * simple" precedent — this app has never shipped a hover layer on a chart,
 * and a legend-plus-table-view reader can already get every value without one).
 *
 * Series colors come from --smi-series-1..5 (src/app/globals.css) — the
 * dataviz-skill-validated categorical palette, fixed order, never reassigned
 * by value. The legend below the bars is the required "visible labels" relief
 * for the three slots that sit under 3:1 contrast on white.
 */

import { ChartAxis } from "@/components/ChartAxis";

const SERIES_COLORS = ["var(--smi-series-1)", "var(--smi-series-2)", "var(--smi-series-3)", "var(--smi-series-4)", "var(--smi-series-5)"];

/** Smallest height a non-zero segment is drawn at, and the gap between segments. */
const SEGMENT_MIN_PX = 2;
const SEGMENT_GAP_PX = 2;

/** The least height a bar of n segments needs to draw each one at its minimum. */
export function barFloorPx(n: number): number {
  return n * SEGMENT_MIN_PX + Math.max(0, n - 1) * SEGMENT_GAP_PX;
}

export type ChartSeries = { label: string; values: number[] }; // month-aligned to `labels`, missing months already 0

export function StackedTrendChart({ labels, series, height = 140 }: { labels: string[]; series: ChartSeries[]; height?: number }) {
  const totals = series.map((s) => s.values.reduce((a, b) => a + b, 0));
  if (labels.length < 2 || totals.every((t) => t === 0)) return <p className="text-sm text-graphite">Not enough data yet.</p>;

  const stackedTotals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(...stackedTotals, 1);

  const legendEntries = series
    .map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
    .filter((s) => s.values.some((v) => v > 0));

  const ariaLabel = `${labels[0]} to ${labels.at(-1)} — ${series.map((s, i) => `${s.label} ${totals[i].toLocaleString()}`).join(", ")}`;

  // Bars are HTML boxes sized in percent, not an SVG stretched with
  // preserveAspectRatio="none": the 600-unit drawing was squeezed to ~310px on
  // a phone and the rounded bar tops distorted (#33 M11). One slot per month,
  // shared with ChartAxis below so each label sits under its bar. Mark specs
  // from the dataviz skill: bars <=24px and never filling the slot, a 2px gap
  // between stacked segments, a 4px rounded data-end only on the top segment.
  //
  // The BAR is sized by the month's total, and its segments share that height
  // by value (flex-grow), so the 2px gaps come out of the bar rather than
  // being added on top of it — the bar's height stays proportional. Every
  // non-zero segment keeps at least SEGMENT_MIN_PX, so a series that is tiny
  // next to the others still shows; the bar's own floor makes room for that.
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="relative border-b border-line pt-5" style={{ height }}>
        {/* the peak, so a bar's height means something */}
        <span aria-hidden className="absolute left-0 top-0 text-xs text-graphite">{max.toLocaleString("en-GB")}</span>
        <span aria-hidden className="absolute inset-x-0 top-5 border-t border-dashed border-line" />
        <div className="relative flex h-full">
          {labels.map((label, i) => {
            const segments = series
              .map((s, si) => ({ value: s.values[i] ?? 0, color: SERIES_COLORS[si % SERIES_COLORS.length] }))
              .filter((seg) => seg.value > 0);
            return (
              // Index keys: labels are the caller's and need not be unique.
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                {segments.length > 0 && (
                  <div
                    data-testid="stacked-bar"
                    className="flex w-3/5 max-w-6 flex-col-reverse gap-[2px]"
                    style={{ height: `max(${(stackedTotals[i] / max) * 100}%, ${barFloorPx(segments.length)}px)` }}
                  >
                    {segments.map((seg, si) => (
                      <div
                        key={si}
                        className={si === segments.length - 1 ? "rounded-t" : ""}
                        style={{ flex: `${seg.value} 1 0px`, minHeight: SEGMENT_MIN_PX, background: seg.color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ChartAxis labels={labels} />
      {legendEntries.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-graphite">
          {legendEntries.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
