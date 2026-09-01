import type { ReactNode } from "react";

// Console-only primitives: one home for the card shell, so the console stays
// internally consistent. The hairline border was added when a retired theme
// used pure-white paper; it still earns its place separating a white card from
// the paper ground, which is near-white.

export function Card({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`rounded-xl border border-black/5 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-bold text-ink">
      <span aria-hidden className="inline-block h-3.5 w-1 shrink-0 rounded-full bg-brand" />
      {children}
    </h2>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-ink/10 text-ink",
  brand: "bg-brand/20 text-ink",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${BADGE_TONES[tone]}`}>{children}</span>;
}
