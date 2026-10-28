import Link from "next/link";
import type { FeaturedEventSource } from "@/lib/featured-event";
import { Badge, Card } from "./ui";

export type FeaturedEventCardProps = {
  /** what the homepage's top card shows today (queries.ts featuredEvent()) */
  live: {
    event: { title: string; slug: string; starts_on: string } | null;
    source: FeaturedEventSource;
    placement: { starts_on: string; ends_on: string } | null;
  };
  /** the next booking that hasn't started yet, if any */
  next: { title: string; starts_on: string; ends_on: string; awaiting_payment: boolean } | null;
};

const SOURCE: Record<FeaturedEventSource, { label: string; tone: "green" | "neutral" }> = {
  booked: { label: "Booked", tone: "green" },
  backup: { label: "Backup pin", tone: "neutral" },
  fallback: { label: "Next upcoming (automatic)", tone: "neutral" },
};

/**
 * Above the console Events board: which event the homepage's top card is
 * showing and why, and what's booked next — so whoever is editing events can
 * see the pinned one without going to Adverts. Managed on the Featured Event
 * page; this card only reports.
 */
export function FeaturedEventCard({ live, next }: FeaturedEventCardProps) {
  const source = SOURCE[live.source];
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-graphite">Featured event on the homepage</p>
          {live.event ? (
            <p className="mt-1 text-sm">
              <Link href={`/event/${live.event.slug}`} className="font-semibold text-ink hover:underline">{live.event.title}</Link>
              <span className="text-graphite"> · {live.event.starts_on}</span>
              <span className="ml-2"><Badge tone={source.tone}>{source.label}</Badge></span>
              {live.placement && <span className="ml-2 text-xs text-graphite">booked {live.placement.starts_on} → {live.placement.ends_on}</span>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-graphite">No upcoming published event, so the homepage card is hidden.</p>
          )}
          <p className="mt-1 text-xs text-graphite">
            {next
              ? <>Next booked: <span className="text-ink">{next.title}</span>, {next.starts_on} → {next.ends_on}{next.awaiting_payment && " (awaiting payment)"}</>
              : "Nothing else booked."}
          </p>
        </div>
        <Link href="/console/adverts/featured-event" className="shrink-0 text-sm text-ink hover:underline">Manage →</Link>
      </div>
    </Card>
  );
}
