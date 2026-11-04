/**
 * Hand-built inline-SVG trend rendering — no chart library exists in this
 * app. These two are the single-series shapes (a stat-tile sparkline, a
 * larger single-series trend line): no legend or categorical palette, brand
 * orange is the one accent, per globals.css's "brand only ever as a non-text
 * accent" rule — never used for the numbers beside it. A third, multi-series
 * shape (StackedTrendChart.tsx) exists for the two categorical cases that
 * need a breakdown by series rather than a single line — it draws from the
 * dataviz-skill-validated --smi-series-* palette instead.
 */

import { ChartAxis } from "@/components/ChartAxis";

function points(values: number[], width: number, height: number, pad: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Small stat-tile trend: gray history, the current (last) point in brand orange. */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const pad = 3;
  const line = points(values, width, height, pad);
  const last = line.split(" ").at(-1)!;
  const first = values[0];
  const current = values.at(-1)!;
  const deltaPct = first > 0 ? Math.round(((current - first) / first) * 100) : null;
  const direction = deltaPct == null ? "flat" : deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "flat";
  const label = `12-month trend, ${first} to ${current} views, ${direction}${deltaPct != null ? ` ${Math.abs(deltaPct)}%` : ""} over the period`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <polyline points={line} fill="none" stroke="var(--smi-line)" strokeWidth={2} />
      <polyline
        points={line.split(" ").slice(-2).join(" ")}
        fill="none"
        stroke="var(--smi-brand)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={last.split(",")[0]} cy={last.split(",")[1]} r={2.5} fill="var(--smi-brand)" />
    </svg>
  );
}

/**
 * Larger single-series line — the member Stats page's "Page performance" and
 * the admin analytics page. No hover/tooltip layer — deliberately kept simple.
 *
 * #33 M11: points sit at the centre of equal slots, the same slots ChartAxis
 * labels below, so each month or day label sits under its point. The SVG still
 * stretches to the box (preserveAspectRatio="none") — fine for a line, and
 * non-scaling-stroke keeps the stroke from thinning or fattening as it does.
 * With `zeroIsEmpty`, all-zero data reads "Not enough data yet" rather than a
 * flat line — right for a member page that has only just started collecting,
 * wrong for the console's analytics, where a measured range of zero views is a
 * real answer and keeps its flat line.
 */
export function TrendChart({ values, labels, height = 140, zeroIsEmpty = false }: { values: number[]; labels: string[]; height?: number; zeroIsEmpty?: boolean }) {
  if (values.length < 2 || (zeroIsEmpty && values.every((v) => v === 0))) return <p className="text-sm text-graphite">Not enough data yet.</p>;
  const width = 600;
  const top = 20; // room for the peak label
  const bottom = 4;
  const max = Math.max(...values, 1);
  const line = values
    .map((v, i) => {
      const x = ((i + 0.5) / values.length) * width;
      const y = top + (1 - v / max) * (height - top - bottom);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <div className="relative">
        <span aria-hidden className="absolute left-0 top-0 text-xs text-graphite">{max.toLocaleString("en-GB")}</span>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`Trend from ${labels[0]} to ${labels.at(-1)}, peak ${max}`} preserveAspectRatio="none" className="block">
          <line x1={0} y1={top} x2={width} y2={top} stroke="var(--smi-line)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="var(--smi-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <polyline points={line} fill="none" stroke="var(--smi-brand)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <ChartAxis labels={labels} />
    </div>
  );
}
