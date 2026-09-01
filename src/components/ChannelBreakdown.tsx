/**
 * Horizontal bar list for a click-by-channel breakdown (A5.10). Each row is
 * already directly labeled with its channel name, so distinguishing rows by
 * hue would just be decoration — one brand-orange fill, length encodes count.
 */
export function ChannelBreakdown({ rows }: { rows: { label: string; count: number }[] }) {
  const sorted = [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return <p className="text-sm text-gray-500">No clicks recorded yet.</p>;
  const max = Math.max(...sorted.map((r) => r.count));
  return (
    <ul className="space-y-2">
      {sorted.map((r) => (
        <li key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate text-graphite">{r.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max((r.count / max) * 100, 4)}%` }} />
          </span>
          <span className="w-10 shrink-0 text-right font-semibold text-ink">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}
