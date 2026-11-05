/**
 * The shared x-axis for the hand-rolled charts (Sparkline.tsx's TrendChart and
 * StackedTrendChart.tsx). Both used to carry their labels only in an
 * aria-label, so nobody could tell which month a bar or point was (#33 M11).
 *
 * Plain HTML in a flex row of equal slots — one per data point — so a label
 * sits under its bar at any width; the charts place their marks at the centre
 * of the same slots.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" → "Mar", "2026-10-01" → "1 Oct"; anything else is shown as given. */
export function axisLabel(key: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return MONTHS[Number(month[2]) - 1] ?? key;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1] ?? day[2]}`;
  return key;
}

/**
 * Which slots carry a visible label: every one up to 12 points (a year of
 * months) on wider screens, about six on phones, so labels never collide.
 * Returns, per slot, "all" (always shown), "wide" (sm and up only) or "none".
 */
export function axisTicks(count: number): ("all" | "wide" | "none")[] {
  const wideStep = Math.max(1, Math.ceil(count / 12));
  // A multiple of wideStep, so the phone labels are a subset of the wide ones
  // and the spacing stays even at both sizes.
  const narrowStep = wideStep * Math.max(1, Math.ceil(Math.ceil(count / 6) / wideStep));
  // Counted back from the newest point, so the current month always has its label.
  return Array.from({ length: count }, (_, i) => {
    const fromEnd = count - 1 - i;
    if (fromEnd % narrowStep === 0) return "all";
    if (fromEnd % wideStep === 0) return "wide";
    return "none";
  });
}

export function ChartAxis({ labels }: { labels: string[] }) {
  const ticks = axisTicks(labels.length);
  return (
    // Decorative for screen readers — each chart's aria-label already names the range.
    <div aria-hidden className="mt-1 flex text-xs text-graphite">
      {labels.map((l, i) => (
        // Index keys: labels are the caller's and need not be unique.
        <span
          key={i}
          className={`min-w-0 flex-1 overflow-visible whitespace-nowrap text-center ${
            ticks[i] === "none" ? "invisible" : ticks[i] === "wide" ? "invisible sm:visible" : ""
          }`}
        >
          {axisLabel(l)}
        </span>
      ))}
    </div>
  );
}
