/**
 * Multi-series monthly stacked-bar chart — the categorical counterpart to
 * Sparkline.tsx's single-series shapes, for the two Month-by-month boxes that
 * need a breakdown (advert impressions by location, clicks by channel) rather
 * than a single trend line. Same hand-rolled-SVG house style as TrendChart:
 * fixed viewBox, no hover/tooltip layer (TrendChart's own "deliberately kept
 * simple" precedent — this app has never shipped a hover layer on a chart,
 * and a legend-plus-table-view reader can already get every value without one).
 *
 * Series colors come from --smi-series-1..5 (src/app/globals.css) — the
 * dataviz-skill-validated categorical palette, fixed order, never reassigned
 * by value. The legend below the bars is the required "visible labels" relief
 * for the three slots that sit under 3:1 contrast on white.
 */

const SERIES_COLORS = ["var(--smi-series-1)", "var(--smi-series-2)", "var(--smi-series-3)", "var(--smi-series-4)", "var(--smi-series-5)"];

export type ChartSeries = { label: string; values: number[] }; // month-aligned to `labels`, missing months already 0

const MAX_BAR_WIDTH = 24; // dataviz skill mark spec: bars <=24px thick, never fill the slot
const SEGMENT_GAP = 2; // dataviz skill spacer spec: 2px surface gap between touching marks
const CAP_RADIUS = 4; // dataviz skill mark spec: 4px rounded data-end, square at the baseline

export function StackedTrendChart({ labels, series, height = 140 }: { labels: string[]; series: ChartSeries[]; height?: number }) {
  const totals = series.map((s) => s.values.reduce((a, b) => a + b, 0));
  if (labels.length < 2 || totals.every((t) => t === 0)) return <p className="text-sm text-graphite">Not enough data yet.</p>;

  const width = 600;
  const pad = 8;
  const innerWidth = width - pad * 2;
  const plotHeight = height - pad * 2;
  const barSlot = innerWidth / labels.length;
  const barWidth = Math.min(MAX_BAR_WIDTH, barSlot);

  const stackedTotals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(...stackedTotals, 1);
  const baselineY = height - pad;

  const legendEntries = series
    .map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
    .filter((s) => s.values.some((v) => v > 0));

  const ariaLabel = `${labels[0]} to ${labels.at(-1)} — ${series.map((s, i) => `${s.label} ${totals[i].toLocaleString()}`).join(", ")}`;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        <line x1={pad} y1={baselineY} x2={width - pad} y2={baselineY} stroke="var(--smi-line)" strokeWidth={1} />
        {labels.map((_, i) => {
          const x = pad + i * barSlot + (barSlot - barWidth) / 2;
          const segments = series
            .map((s, si) => ({ value: s.values[i] ?? 0, color: SERIES_COLORS[si % SERIES_COLORS.length] }))
            .filter((seg) => seg.value > 0);
          const topIndex = segments.length - 1;
          let y = baselineY;
          return (
            <g key={i}>
              {segments.map((seg, si) => {
                const h = (seg.value / max) * plotHeight;
                y -= h;
                const segY = y;
                y -= SEGMENT_GAP;
                if (si !== topIndex) return <rect key={si} x={x} y={segY} width={barWidth} height={h} fill={seg.color} />;
                // Topmost segment only: rounded data-end, square everywhere it touches a neighbor or the baseline.
                const r = Math.min(CAP_RADIUS, barWidth / 2, h);
                return (
                  <g key={si}>
                    <rect x={x} y={segY} width={barWidth} height={h} rx={r} fill={seg.color} />
                    <rect x={x} y={segY + r} width={barWidth} height={Math.max(h - r, 0)} fill={seg.color} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
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
