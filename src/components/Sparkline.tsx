/**
 * Hand-built inline-SVG trend rendering — no chart library exists in this
 * app, and these are the only two trend shapes needed (a stat-tile sparkline,
 * a single-series admin trend line). Single series throughout, so no legend
 * or categorical palette: brand orange is the one accent, per globals.css's
 * "brand only ever as a non-text accent" rule — never used for the numbers
 * beside it.
 */

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

/** Larger single-series line for the admin analytics page. No hover/tooltip layer — deliberately kept simple. */
export function TrendChart({ values, labels, height = 140 }: { values: number[]; labels: string[]; height?: number }) {
  if (values.length < 2) return <p className="text-sm text-graphite">Not enough data yet.</p>;
  const width = 600;
  const pad = 8;
  const line = points(values, width, height, pad);
  const max = Math.max(...values, 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`Trend from ${labels[0]} to ${labels.at(-1)}, peak ${max}`} preserveAspectRatio="none">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--smi-line)" strokeWidth={1} />
      <polyline points={line} fill="none" stroke="var(--smi-brand)" strokeWidth={2} />
    </svg>
  );
}
